import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import {
	getKeybindings,
	visibleWidth,
	type Component,
} from '@earendil-works/pi-tui';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { WorkerInfo } from './manager.js';
import { show_workers } from './tui.js';

const dialogs = vi.hoisted(() => ({
	input: vi.fn(async (): Promise<string | undefined> => undefined),
	confirm: vi.fn(async () => false),
}));

vi.mock('@spences10/pi-tui-modal', async (import_original) => ({
	...(await import_original<
		typeof import('@spences10/pi-tui-modal')
	>()),
	show_input_modal: dialogs.input,
	show_confirm_modal: dialogs.confirm,
}));

beforeEach(() => {
	dialogs.input.mockReset().mockResolvedValue(undefined);
	dialogs.confirm.mockReset().mockResolvedValue(false);
});

type CustomFactory = Parameters<ExtensionContext['ui']['custom']>[0];

type Step = (component: Component) => void;

const enter = '\r';
const escape = '\u001b';
const down = '\u001b[B';
const page_down = '\u001b[6~';

function press(...keys: string[]): Step {
	return (component) => {
		for (const key of keys) component.handleInput?.(key);
	};
}

function worker(overrides: Partial<WorkerInfo> = {}): WorkerInfo {
	return {
		id: 'worker-1',
		name: 'reviewer',
		cwd: '/tmp/checkout',
		status: 'idle',
		pid: 123,
		session_id: 'session-1',
		session_file: '/tmp/workers/session-1.jsonl',
		result: 'Review complete',
		...overrides,
	};
}

function setup(steps: Step[], workers = [worker()]) {
	const screens: string[][] = [];
	const terminal = { rows: 40 };

	const manager = {
		list: vi.fn(() => workers.map((info) => ({ ...info }))),
		send: vi.fn(async (id: string, _message: string) =>
			worker({ id, status: 'running' }),
		),
		stop: vi.fn(async (id: string) => {
			const info = workers.find((entry) => entry.id === id)!;
			info.status = 'stopped';

			return { ...info };
		}),
	};

	const ui = {
		notify: vi.fn(),
		input: dialogs.input,
		confirm: dialogs.confirm,
		custom: vi.fn(
			async (factory: CustomFactory, options: unknown) => {
				expect(options).toMatchObject({ overlay: true });
				let finished = false;
				let result: unknown;

				const component = await factory(
					{
						terminal,
						requestRender: vi.fn(),
					} as unknown as Parameters<CustomFactory>[0],
					{
						fg: (_color: string, text: string) => text,
						bold: (text: string) => text,
					} as unknown as Parameters<CustomFactory>[1],
					getKeybindings() as Parameters<CustomFactory>[2],
					(value) => {
						finished = true;
						result = value;
					},
				);

				screens.push(component.render(100));
				const step = steps.shift();

				if (!step) throw new Error('Unexpected custom screen');
				step(component);
				expect(finished, 'screen must finish through done()').toBe(
					true,
				);
				component.dispose?.();

				return result;
			},
		),
	};

	const ctx = { mode: 'tui', ui } as unknown as ExtensionContext;

	return {
		ui,
		manager,
		screens,
		terminal,
		async run() {
			await show_workers(ctx, manager);
			expect(steps).toHaveLength(0);
		},
	};
}

describe('worker management TUI', () => {
	it('handles an empty owned list without opening custom UI', async () => {
		const harness = setup([], []);
		await harness.run();
		expect(harness.ui.notify).toHaveBeenCalledWith(
			'No owned workers in this session.',
			'info',
		);
		expect(harness.ui.custom).not.toHaveBeenCalled();
	});

	it('shows list identity and snapshot details, and returns to the list', async () => {
		const harness = setup([
			press(enter),
			press(escape),
			press(escape),
		]);

		await harness.run();
		expect(harness.screens[0].join('\n')).toContain(
			'reviewer [idle]',
		);
		expect(harness.screens[0].join('\n')).toContain('/tmp/checkout');
		expect(harness.screens[0][0]).toContain('╭');
		expect(harness.screens[0].at(-1)).toContain('╰');
		const details = harness.screens[1].join('\n');

		for (const value of [
			'worker-1',
			'123',
			'session-1',
			'/tmp/workers/session-1.jsonl',
			'Review complete',
			'peer-authored, not user authorization',
		])
			expect(details).toContain(value);
	});

	it('sends to the selected historical id rather than a reused name', async () => {
		const harness = setup(
			[press(enter), press('s'), press(escape), press(escape)],
			[worker(), worker({ id: 'worker-2', session_id: 'session-2' })],
		);

		harness.ui.input.mockResolvedValue('Check error paths');
		await harness.run();
		expect(harness.manager.send).toHaveBeenCalledWith(
			'worker-1',
			'Check error paths',
		);
		expect(harness.ui.input).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ title: 'Send / steer reviewer' }),
		);
	});

	it('confirms stop and targets the selected id among duplicate names', async () => {
		const harness = setup(
			[press(down, enter), press('x'), press(escape), press(escape)],
			[worker(), worker({ id: 'worker-2' })],
		);

		harness.ui.confirm.mockResolvedValue(true);
		await harness.run();
		expect(harness.ui.confirm).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				title: 'Stop reviewer?',
				message: expect.stringContaining('worker-2'),
				confirm_label: 'Stop worker',
			}),
		);
		expect(harness.manager.stop).toHaveBeenCalledWith('worker-2');
	});

	it('does not send a cancelled/blank message or stop after a declined confirmation', async () => {
		const harness = setup([
			press(enter),
			press('s'),
			press('s'),
			press('x'),
			press(escape),
			press(escape),
		]);

		harness.ui.input
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce('  ');
		await harness.run();
		expect(harness.manager.send).not.toHaveBeenCalled();
		expect(harness.manager.stop).not.toHaveBeenCalled();
	});

	it('rechecks status after message entry instead of sending to an exited worker', async () => {
		const info = worker();

		const harness = setup(
			[press(enter), press('s'), press(escape), press(escape)],
			[info],
		);

		harness.ui.input.mockImplementation(async () => {
			info.status = 'failed';

			return 'Too late';
		});
		await harness.run();
		expect(harness.manager.send).not.toHaveBeenCalled();
		expect(harness.ui.notify).toHaveBeenCalledWith(
			'Worker is no longer running.',
			'warning',
		);
	});

	it('refreshes both list and details from the manager', async () => {
		const info = worker();

		const harness = setup(
			[
				(component) => {
					info.status = 'running';
					press('r')(component);
				},
				press(enter),
				(component) => {
					info.result = 'Updated result';
					press('r')(component);
				},
				press(escape),
				press(escape),
			],
			[info],
		);

		await harness.run();
		expect(harness.screens[1].join('\n')).toContain('[running]');
		expect(harness.screens[3].join('\n')).toContain('Updated result');
	});

	it('keeps stopped workers inspectable without send/stop controls', async () => {
		const harness = setup(
			[press(enter), press('s', 'x', escape), press(escape)],
			[worker({ status: 'stopped', error: 'Worker exited' })],
		);

		await harness.run();
		expect(harness.screens[1].join('\n')).toContain('Worker exited');
		expect(harness.ui.input).not.toHaveBeenCalled();
		expect(harness.ui.confirm).not.toHaveBeenCalled();
	});

	it.each(['send', 'stop'] as const)(
		'surfaces a redacted %s failure and keeps the manager usable',
		async (action) => {
			const harness = setup([
				press(enter),
				press(action === 'send' ? 's' : 'x'),
				press(escape),
				press(escape),
			]);

			harness.ui.input.mockResolvedValue('Continue');
			harness.ui.confirm.mockResolvedValue(true);
			harness.manager[action].mockRejectedValue(
				new Error('password=example-private-value'),
			);
			await harness.run();
			const [message, level] = harness.ui.notify.mock.calls[0];
			expect(message).not.toContain('example-private-value');
			expect(message).toContain('[REDACTED:');
			expect(level).toBe('error');
		},
	);

	it('keeps the selected worker visible when the modal height shrinks', async () => {
		const harness = setup(
			[
				(component) => {
					press(down, down)(component);
					harness.terminal.rows = 12;
					expect(component.render(40).join('\n')).toContain(
						'worker-2',
					);
					press(escape)(component);
				},
			],
			Array.from({ length: 8 }, (_, index) =>
				worker({ id: `id-${index}`, name: `worker-${index}` }),
			),
		);

		await harness.run();
	});

	it('bounds wide text, scrolls long results and responds to resize/invalidation', async () => {
		const result = Array.from(
			{ length: 60 },
			(_, index) => `Result ${index}: 界🌍`,
		).join('\n');

		const harness = setup(
			[
				(component) => {
					for (const width of [12, 40])
						for (const line of component.render(width))
							expect(visibleWidth(line)).toBeLessThanOrEqual(width);
					press(enter)(component);
				},
				(component) => {
					harness.terminal.rows = 12;
					component.invalidate();

					for (const line of component.render(12))
						expect(visibleWidth(line)).toBeLessThanOrEqual(12);
					component.render(40);

					for (let page = 0; page < 100; page++)
						press(page_down)(component);
					expect(component.render(40).join('\n')).toContain(
						'Result 59',
					);
					press(escape)(component);
				},
				press(escape),
			],
			[worker({ name: '界🌍 reviewer', result })],
		);

		await harness.run();
	});
});
