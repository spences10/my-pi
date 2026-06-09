import type { ObservabilityEvent } from '../../types';

type Event = ObservabilityEvent<Record<string, unknown>>;

export type TurnGroup = {
	id: string;
	title: string;
	start?: Event;
	end?: Event;
	events: Event[];
	duration_ms: number;
	errors: number;
	tools: number;
	providers: number;
};

function is_error_status(value: unknown) {
	return typeof value === 'string' && value.toLowerCase() === 'error';
}

function has_error_value(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	const record = value as Record<string, unknown>;
	if (
		Boolean(record.error) ||
		record.isError === true ||
		is_error_status(record.status)
	)
		return true;
	return Object.values(record).some(has_error_value);
}

export function event_has_error(event: Event) {
	return event.type === 'error' || has_error_value(event.payload);
}

function elapsed(start?: Event, end?: Event) {
	if (!start || !end) return 0;
	return Math.max(
		0,
		new Date(end.ts).valueOf() - new Date(start.ts).valueOf(),
	);
}

export function build_turns(events: Event[]): TurnGroup[] {
	const ordered = [...events].sort((a, b) => a.seq - b.seq);
	const groups: TurnGroup[] = [];
	let current: TurnGroup | null = null;
	for (const event of ordered) {
		if (event.type === 'turn_start') {
			current = {
				id: event.event_id,
				title: `Turn ${groups.length + 1}`,
				start: event,
				events: [event],
				duration_ms: 0,
				errors: 0,
				tools: 0,
				providers: 0,
			};
			groups.push(current);
			continue;
		}
		if (!current) {
			current = {
				id: `setup:${event.event_id}`,
				title: 'Session setup',
				events: [],
				duration_ms: 0,
				errors: 0,
				tools: 0,
				providers: 0,
			};
			groups.push(current);
		}
		current.events.push(event);
		if (event.type === 'turn_end') {
			current.end = event;
			current = null;
		}
	}
	for (const group of groups) {
		group.duration_ms = elapsed(
			group.start || group.events[0],
			group.end || group.events[group.events.length - 1],
		);
		group.errors = group.events.filter(event_has_error).length;
		group.tools = group.events.filter((event) =>
			event.type.startsWith('tool'),
		).length;
		group.providers = group.events.filter((event) =>
			event.type.startsWith('provider'),
		).length;
	}
	return groups.reverse();
}
