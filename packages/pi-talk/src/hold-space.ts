import {
	isKeyRelease,
	isKeyRepeat,
	Key,
	matchesKey,
} from '@earendil-works/pi-tui';

const HOLD_MS = 300;
const FIRST_REPEAT_MS = 650;
const RELEASE_MS = 180;

type HoldCallbacks = {
	on_start(): boolean;
	on_stop(): void;
};

export class HoldSpace {
	private pressedAt: number | undefined;
	private recording = false;
	private attempted = false;
	private legacyPresses = 0;
	private legacyReleaseTimer:
		| ReturnType<typeof setTimeout>
		| undefined;

	constructor(private readonly callbacks: HoldCallbacks) {}

	handle(data: string): boolean {
		if (!matchesKey(data, Key.space)) {
			// Typing or moving the cursor cancels the candidate immediately.
			// A late release from another key must not cancel a Space hold.
			if (!isKeyRelease(data)) this.release();
			return false;
		}
		if (data === ' ') return this.handle_legacy_space();

		if (isKeyRelease(data)) {
			this.release();
			return true;
		}

		if (!isKeyRepeat(data)) {
			if (this.legacyPresses) this.release();
			this.pressedAt = Date.now();
			// Insert the initial space immediately, preserving key order.
			// Never rewind the editor to remove it when a hold starts.
			return false;
		}

		if (this.pressedAt === undefined) return false;
		if (Date.now() - this.pressedAt >= HOLD_MS) this.start();
		return !this.attempted || this.recording;
	}

	reset(): void {
		if (this.legacyReleaseTimer)
			clearTimeout(this.legacyReleaseTimer);
		this.legacyReleaseTimer = undefined;
		this.pressedAt = undefined;
		this.recording = false;
		this.attempted = false;
		this.legacyPresses = 0;
	}

	private handle_legacy_space(): boolean {
		if (!this.legacyPresses) {
			this.release();
			this.pressedAt = Date.now();
		}
		this.legacyPresses += 1;
		// A double tap is ordinary input. Require a sustained run with
		// another repeat before inferring a hold in legacy terminals.
		if (
			this.legacyPresses >= 3 &&
			this.pressedAt !== undefined &&
			Date.now() - this.pressedAt >= HOLD_MS
		)
			this.start();
		if (this.legacyReleaseTimer)
			clearTimeout(this.legacyReleaseTimer);
		this.legacyReleaseTimer = setTimeout(
			() => this.release(),
			this.legacyPresses === 1 ? FIRST_REPEAT_MS : RELEASE_MS,
		);
		// Keep every space already inserted. Only consume repeats after
		// recording actually starts; there is no editor snapshot rollback.
		return this.recording;
	}

	private start(): void {
		if (this.attempted) return;
		this.attempted = true;
		this.recording = this.callbacks.on_start();
	}

	private release(): void {
		const recording = this.recording;
		this.reset();
		if (recording) this.callbacks.on_stop();
	}
}
