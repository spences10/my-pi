import { runCommand, runMain } from 'citty';
import { resolve } from 'node:path';
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vite-plus/test';

const mocks = vi.hoisted(() => {
	const runtime = { diagnostics: [], dispose: vi.fn() };
	return {
		runtime,
		create_my_pi: vi.fn(async () => runtime),
		runPrintMode: vi.fn(async () => 0),
		runRpcMode: vi.fn(async () => undefined),
		interactive_run: vi.fn(async () => undefined),
	};
});

vi.mock('citty', async (import_original) => ({
	...(await import_original<typeof import('citty')>()),
	runMain: vi.fn(),
}));
vi.mock('./api.js', () => ({ create_my_pi: mocks.create_my_pi }));
vi.mock('@earendil-works/pi-coding-agent', () => ({
	runPrintMode: mocks.runPrintMode,
	runRpcMode: mocks.runRpcMode,
	InteractiveMode: class {
		run = mocks.interactive_run;
	},
}));

const original_argv = process.argv;
const original_stdin_tty = Object.getOwnPropertyDescriptor(
	process.stdin,
	'isTTY',
);
const original_stdout_tty = Object.getOwnPropertyDescriptor(
	process.stdout,
	'isTTY',
);
const exit_error = new Error('CLI exit');
const exit_spy = vi.fn((): never => {
	throw exit_error;
});

beforeEach(() => {
	vi.clearAllMocks();
	vi.resetModules();
	vi.spyOn(process, 'exit').mockImplementation(exit_spy);
	vi.spyOn(process.stderr, 'write').mockReturnValue(true);
	Object.defineProperty(process.stdin, 'isTTY', {
		configurable: true,
		value: true,
	});
	Object.defineProperty(process.stdout, 'isTTY', {
		configurable: true,
		value: true,
	});
});

afterEach(() => {
	process.argv = original_argv;
	for (const [stream, descriptor] of [
		[process.stdin, original_stdin_tty],
		[process.stdout, original_stdout_tty],
	] as const) {
		if (descriptor)
			Object.defineProperty(stream, 'isTTY', descriptor);
		else Reflect.deleteProperty(stream, 'isTTY');
	}
	vi.restoreAllMocks();
});

async function run_cli(argv: string[], exits = true): Promise<void> {
	process.argv = [process.execPath, resolve('src/index.ts'), ...argv];
	await import('./index.js');
	const command = vi.mocked(runMain).mock.calls.at(-1)?.[0];
	if (!command) throw new Error('CLI entry point did not register');
	const run = runCommand(command, { rawArgs: argv });
	if (exits) {
		await expect(run).rejects.toBe(exit_error);
		expect(exit_spy).toHaveBeenCalledWith(0);
	} else {
		await run;
	}
}

describe('CLI entry-point handoff', () => {
	it.each([['--json'], ['-j'], ['--mode', 'json'], ['--mode=json']])(
		'uses JSON runtime and output for %j',
		async (...flags) => {
			await run_cli([...flags, 'review this', 'focus on security']);
			expect(mocks.create_my_pi).toHaveBeenCalledWith(
				expect.objectContaining({ runtime_mode: 'json' }),
			);
			expect(mocks.runPrintMode).toHaveBeenCalledWith(mocks.runtime, {
				mode: 'json',
				initialMessage: 'review this focus on security',
				initialImages: [],
				messages: [],
			});
		},
	);

	it.each([['-P'], ['--mode', 'print']])(
		'uses print runtime and text output for %j',
		async (...flags) => {
			await run_cli([...flags, 'first', 'second']);
			expect(mocks.create_my_pi).toHaveBeenCalledWith(
				expect.objectContaining({ runtime_mode: 'print' }),
			);
			expect(mocks.runPrintMode).toHaveBeenCalledWith(
				mocks.runtime,
				expect.objectContaining({
					mode: 'text',
					initialMessage: 'first second',
				}),
			);
		},
	);

	it.each(['json', 'print'])(
		'honours explicit %s mode without a prompt',
		async (mode) => {
			await run_cli(['--mode', mode]);
			expect(mocks.runPrintMode).toHaveBeenCalledWith(
				mocks.runtime,
				expect.objectContaining({
					mode: mode === 'json' ? 'json' : 'text',
					initialMessage: '',
				}),
			);
			expect(mocks.interactive_run).not.toHaveBeenCalled();
		},
	);

	it('keeps option-looking tokens after -- only in the prompt', async () => {
		const literal = [
			'--extension',
			'./unwanted.ts',
			'--tools',
			'write',
			'--exclude-tools=read',
			'--skill',
			'unwanted',
			'--preset=unwanted',
			'-z',
		];
		await run_cli(['--mode', 'json', 'review', '--', ...literal]);
		expect(mocks.create_my_pi).toHaveBeenCalledWith(
			expect.objectContaining({
				extensions: [],
				selected_tools: undefined,
				excluded_tools: undefined,
				selected_skills: undefined,
				extension_flag_values: new Map(),
			}),
		);
		expect(mocks.runPrintMode).toHaveBeenCalledWith(
			mocks.runtime,
			expect.objectContaining({
				initialMessage: ['review', ...literal].join(' '),
			}),
		);
	});

	it('preserves repeated, short, equals, and extension-defined flags before --', async () => {
		await run_cli([
			'-j',
			'-e',
			'./first.ts',
			'--extension=./second.ts',
			'-t',
			'read,bash',
			'--tools=read,edit',
			'-xt',
			'write',
			'--exclude-tools=find',
			'--skill=review',
			'--skill',
			'audit',
			'--probe-string=alpha',
			'--probe-boolean',
			'--',
			'literal prompt',
		]);
		expect(mocks.create_my_pi).toHaveBeenCalledWith(
			expect.objectContaining({
				extensions: [resolve('first.ts'), resolve('second.ts')],
				selected_tools: ['read', 'bash', 'edit'],
				excluded_tools: ['write', 'find'],
				selected_skills: ['review', 'audit'],
				extension_flag_values: new Map<string, boolean | string>([
					['probe-string', 'alpha'],
					['probe-boolean', true],
				]),
			}),
		);
	});

	it('keeps named prompt precedence over all positional text', async () => {
		await run_cli([
			'--mode=json',
			'-p',
			'named prompt',
			'ignored positional',
			'--',
			'ignored literal',
		]);
		expect(mocks.runPrintMode).toHaveBeenCalledWith(
			mocks.runtime,
			expect.objectContaining({ initialMessage: 'named prompt' }),
		);
	});

	it('keeps JSON flag precedence over explicit print mode', async () => {
		await run_cli(['--mode=print', '-P', '--json', 'prompt']);
		expect(mocks.runPrintMode).toHaveBeenCalledWith(
			mocks.runtime,
			expect.objectContaining({ mode: 'json' }),
		);
	});

	it('keeps RPC execution out of print mode', async () => {
		await run_cli(['--mode=rpc'], false);
		expect(mocks.runRpcMode).toHaveBeenCalledWith(mocks.runtime);
		expect(mocks.runPrintMode).not.toHaveBeenCalled();
	});
});
