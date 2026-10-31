import { SvelteMap } from 'svelte/reactivity';
import { api_fetch, type DashboardEvent } from './api.js';

const ACTIVE_WINDOW_MS = 90_000;
const REFRESH_DELAY_MS = 1_000;

/**
 * Live state from the server's event stream. Views read `revision`
 * (all data) or `session_revision(id)` (one session) inside an effect
 * to refetch when new events arrive.
 */
class Live {
	connected = $state(false);
	paused = $state(false);
	revision = $state(0);
	now = $state(Date.now());
	readonly last_seen = new SvelteMap<string, number>();
	readonly #session_revisions = new SvelteMap<string, number>();
	readonly #listeners = new Set<(event: DashboardEvent) => void>();
	#refresh_timer: ReturnType<typeof setTimeout> | null = null;
	#pending_sessions = new Set<string>();

	session_revision(session_id: string): number {
		return this.#session_revisions.get(session_id) ?? 0;
	}

	is_active(session_id: string, last_ts?: string): boolean {
		const seen = this.last_seen.get(session_id) ?? 0;
		const stored = last_ts ? Date.parse(last_ts) : 0;
		const latest = Math.max(seen, Number.isNaN(stored) ? 0 : stored);
		return this.now - latest < ACTIVE_WINDOW_MS;
	}

	/** Receives every event, even while paused (for the events tab). */
	on_event(listener: (event: DashboardEvent) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	toggle_paused(): void {
		this.paused = !this.paused;
		if (!this.paused) this.#schedule_refresh();
	}

	receive(event: DashboardEvent): void {
		if (event.type === 'session_shutdown')
			this.last_seen.delete(event.session_id);
		else this.last_seen.set(event.session_id, Date.now());
		for (const listener of this.#listeners) listener(event);
		this.#pending_sessions.add(event.session_id);
		if (!this.paused) this.#schedule_refresh();
	}

	#schedule_refresh(): void {
		if (this.#refresh_timer) return;
		this.#refresh_timer = setTimeout(() => {
			this.#refresh_timer = null;
			if (this.paused) return;
			for (const id of this.#pending_sessions)
				this.#session_revisions.set(
					id,
					this.session_revision(id) + 1,
				);
			this.#pending_sessions.clear();
			this.revision += 1;
		}, REFRESH_DELAY_MS);
	}

	connect(): () => void {
		const controller = new AbortController();
		const clock = setInterval(() => (this.now = Date.now()), 15_000);
		void this.#consume(controller.signal);
		return () => {
			clearInterval(clock);
			controller.abort();
		};
	}

	#receive_frame(frame: string): void {
		let type = 'message';
		const data: string[] = [];
		for (const line of frame.split(/\r?\n/)) {
			if (line.startsWith('event:')) type = line.slice(6).trim();
			if (line.startsWith('data:'))
				data.push(line.slice(5).trimStart());
		}
		if (type === 'hello') this.connected = true;
		if (type === 'event' && data.length > 0)
			this.receive(JSON.parse(data.join('\n')) as DashboardEvent);
	}

	async #consume(signal: AbortSignal): Promise<void> {
		while (!signal.aborted) {
			try {
				const response = await api_fetch('/events/stream', {
					signal,
				});
				const reader = response.body?.getReader();
				if (!reader) throw new Error('Missing event stream body');
				const decoder = new TextDecoder();
				let buffered = '';
				while (!signal.aborted) {
					const chunk = await reader.read();
					if (chunk.done) break;
					buffered += decoder.decode(chunk.value, { stream: true });
					const frames = buffered.split(/\r?\n\r?\n/);
					buffered = frames.pop() ?? '';
					for (const frame of frames) this.#receive_frame(frame);
				}
			} catch {
				if (signal.aborted) return;
			} finally {
				this.connected = false;
			}
			await new Promise((resolve) => setTimeout(resolve, 1_500));
		}
	}
}

export const live = new Live();
