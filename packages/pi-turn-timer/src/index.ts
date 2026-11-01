import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';

export const TURN_TIMER_ENTRY = 'turn-timer';

export interface TurnTimerEntry {
	duration_ms: number;
	completed_at: string;
	aborted: boolean;
}

export function format_clock(duration_ms: number): string {
	const seconds = Math.max(0, Math.floor(duration_ms / 1000));
	const parts = [Math.floor(seconds / 60) % 60, seconds % 60];
	if (seconds >= 3600) parts.unshift(Math.floor(seconds / 3600));
	return parts.map((part) => String(part).padStart(2, '0')).join(':');
}

export function format_duration(duration_ms: number): string {
	if (duration_ms < 1000)
		return `${Math.max(0, Math.round(duration_ms))}ms`;
	if (duration_ms < 60000)
		return `${(duration_ms / 1000).toFixed(1)}s`;
	return format_clock(duration_ms);
}

export default function turn_timer(pi: ExtensionAPI): void {
	let started_at: number | undefined;
	let interval: ReturnType<typeof setInterval> | undefined;
	let context: ExtensionContext | undefined;

	function reset(): void {
		clearInterval(interval);
		interval = undefined;
		if (context?.mode === 'tui') context.ui.setWorkingMessage();
		context = undefined;
		started_at = undefined;
	}

	function render(): void {
		if (started_at === undefined || context?.mode !== 'tui') return;
		const clock = context.ui.theme.fg(
			'success',
			format_clock(performance.now() - started_at),
		);
		context.ui.setWorkingMessage(`Working... ${clock}`);
	}

	pi.registerEntryRenderer<TurnTimerEntry>(
		TURN_TIMER_ENTRY,
		(entry, _options, theme) => {
			const duration = entry.data?.duration_ms;
			if (
				typeof duration !== 'number' ||
				!Number.isFinite(duration) ||
				duration < 0
			)
				return;
			return new Text(
				theme.fg(
					'success',
					`⏱ ${entry.data?.aborted ? 'Stopped' : 'Completed'} in ${format_duration(duration)}`,
				),
				0,
				0,
			);
		},
	);

	pi.on('agent_start', (_event, ctx) => {
		if (started_at !== undefined) return;
		started_at = performance.now();
		context = ctx;
		if (ctx.mode !== 'tui') return;
		render();
		interval = setInterval(render, 1000);
		interval.unref();
	});

	pi.on('agent_settled', (event) => {
		if (started_at === undefined) return;
		const duration_ms = Math.max(0, performance.now() - started_at);
		reset();
		pi.appendEntry<TurnTimerEntry>(TURN_TIMER_ENTRY, {
			duration_ms,
			completed_at: new Date().toISOString(),
			aborted: event.aborted,
		});
	});

	pi.on('session_start', reset);
	pi.on('session_shutdown', reset);
}
