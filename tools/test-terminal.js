import { Container } from '@earendil-works/pi-tui';
import { vi } from 'vite-plus/test';

/**
 * In-memory terminal: never touches stdin, stdout, or terminal modes.
 * @param {Partial<import('@earendil-works/pi-tui').Terminal>} overrides
 */
export function make_terminal(overrides = {}) {
	return {
		start: vi.fn(),
		stop: vi.fn(),
		drainInput: vi.fn(async () => {}),
		write: vi.fn(),
		columns: 100,
		rows: 40,
		kittyProtocolActive: false,
		moveBy: vi.fn(),
		hideCursor: vi.fn(),
		showCursor: vi.fn(),
		clearLine: vi.fn(),
		clearFromCursor: vi.fn(),
		clearScreen: vi.fn(),
		setTitle: vi.fn(),
		setProgress: vi.fn(),
		setProgramStatus: vi.fn(),
		...overrides,
	};
}

/** @param {import('@earendil-works/pi-tui').Terminal} terminal */
export function make_tui(terminal = make_terminal()) {
	const request_render = vi.fn();

	const tui = Object.assign(new Container(), {
		mode: 'regular',
		terminal,
		fullRedraws: 0,
		getShowHardwareCursor: vi.fn(() => false),
		setShowHardwareCursor: vi.fn(),
		getClearOnShrink: vi.fn(() => false),
		setClearOnShrink: vi.fn(),
		setFocus: vi.fn(),
		showOverlay: vi.fn(() => {
			throw new Error(
				'Overlay behavior is not configured for this fixture',
			);
		}),
		hideOverlay: vi.fn(),
		hasOverlay: vi.fn(() => false),
		start: vi.fn(),
		stop: vi.fn(),
		renderNow: vi.fn(),
		requestRender: request_render,
		addInputListener: vi.fn(() => vi.fn()),
		removeInputListener: vi.fn(),
		onTerminalColorSchemeChange: vi.fn(() => vi.fn()),
		setTerminalColorSchemeNotifications: vi.fn(),
		queryTerminalColors: vi.fn(async () => {
			throw new Error(
				'Terminal colors are not configured for this fixture',
			);
		}),
	});

	return { tui, request_render };
}
