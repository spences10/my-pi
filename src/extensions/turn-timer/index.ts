import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';

export const TURN_TIMER_ENTRY = 'turn-timer';
export interface TurnTimerEntry {
	duration_ms: number;
	completed_at: string;
}

export function format_clock(duration_ms: number): string {
	const total_seconds = Math.max(0, Math.floor(duration_ms / 1_000));
	const hours = Math.floor(total_seconds / 3_600);
	const minutes = Math.floor((total_seconds % 3_600) / 60);
	const seconds = total_seconds % 60;

	return hours > 0
		? `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
		: `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function format_duration(duration_ms: number): string {
	if (duration_ms < 1_000)
		return `${Math.max(0, Math.round(duration_ms))}ms`;
	if (duration_ms < 60_000)
		return `${(duration_ms / 1_000).toFixed(1)}s`;
	return format_clock(duration_ms);
}

export default function turn_timer(pi: ExtensionAPI): void {
	let started_at: number | undefined;
	let refresh_timer: NodeJS.Timeout | undefined;
	let active_context: ExtensionContext | undefined;

	const clear_timer = (): void => {
		if (refresh_timer) clearInterval(refresh_timer);
		refresh_timer = undefined;
	};

	const render_timer = (): void => {
		if (started_at === undefined || !active_context) return;
		const timer = active_context.ui.theme.fg(
			'success',
			format_clock(Date.now() - started_at),
		);
		active_context.ui.setWorkingMessage(`Working... ${timer}`);
	};

	const reset = (): void => {
		clear_timer();
		if (active_context?.mode === 'tui') {
			active_context.ui.setWorkingMessage(undefined);
		}
		started_at = undefined;
		active_context = undefined;
	};

	pi.registerEntryRenderer<TurnTimerEntry>(
		TURN_TIMER_ENTRY,
		(entry, _options, theme) => {
			if (
				!entry.data ||
				typeof entry.data.duration_ms !== 'number' ||
				!Number.isFinite(entry.data.duration_ms)
			) {
				return undefined;
			}
			return new Text(
				theme.fg(
					'success',
					`⏱ Completed in ${format_duration(entry.data.duration_ms)}`,
				),
				0,
				0,
			);
		},
	);

	pi.on('agent_start', async (_event, ctx) => {
		if (started_at !== undefined) return;
		started_at = Date.now();
		active_context = ctx;

		if (ctx.mode !== 'tui') return;
		render_timer();
		refresh_timer = setInterval(render_timer, 1_000);
		refresh_timer.unref?.();
	});

	pi.on('agent_settled', async () => {
		if (started_at === undefined) return;
		const duration_ms = Date.now() - started_at;
		reset();
		pi.appendEntry<TurnTimerEntry>(TURN_TIMER_ENTRY, {
			duration_ms,
			completed_at: new Date().toISOString(),
		});
	});

	pi.on('session_shutdown', async () => {
		reset();
	});
}
