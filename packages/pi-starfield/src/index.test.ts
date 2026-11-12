import {
	make_api,
	make_context,
	make_model,
	make_model_registry,
	make_stream,
	make_assistant_message,
} from '../../../tools/test-sdk.js';
import type {
	AgentEndEvent,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionUIContext,
} from '@earendil-works/pi-coding-agent';
import {
	read_package_settings,
	write_package_settings,
} from '@spences10/pi-settings';
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vite-plus/test';
import starfield from './index.js';

vi.mock('@spences10/pi-settings', () => ({
	read_package_settings: vi.fn(() => ({})),
	write_package_settings: vi.fn(),
}));

type EditorFactory = Parameters<
	ExtensionUIContext['setEditorComponent']
>[0];

function setup(mode: ExtensionContext['mode'] = 'tui') {
	const handlers = new Map<string, Function>();

	let command: Parameters<ExtensionAPI['registerCommand']>[1];

	const api = make_api({
		on: (name: string, handler: Function) => {
			handlers.set(name, handler);

			return () => {
				handlers.delete(name);
			};
		},
		registerCommand: (_name: string, value: typeof command) => {
			command = value;
		},
	});

	let factory: EditorFactory;
	const notify = vi.fn();

	const set_editor = vi.fn((value: EditorFactory) => {
		factory = value;
	});

	const stream_simple = vi.fn(() =>
		make_stream(async () =>
			make_assistant_message({
				content: [{ type: 'text', text: '"run the tests"' }],
			}),
		),
	);

	const ctx = make_context({
		mode,
		hasUI: mode === 'tui' || mode === 'rpc',
		model: make_model({ id: 'test-model' }),
		modelRegistry: make_model_registry({
			streamSimple: stream_simple,
		}),
		ui: {
			getEditorComponent: () => factory,
			setEditorComponent: set_editor,
			notify,
		},
	});

	starfield(api);

	return {
		ctx,
		set_editor,
		notify,
		stream_simple,
		emit: (event: string, payload: Partial<AgentEndEvent> = {}) =>
			handlers.get(event)?.(payload, ctx),
		command: (args: string) =>
			command.handler(args, ctx as ExtensionCommandContext),
		get_factory: () => factory,
		set_factory: (value: EditorFactory) => {
			factory = value;
		},
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv('TERM', 'xterm-256color');
	vi.stubEnv('NO_COLOR', undefined);
	vi.mocked(read_package_settings).mockReturnValue({});
});

afterEach(() => vi.unstubAllEnvs());

describe('starfield extension', () => {
	it('installs by default and restores the normal editor on shutdown', () => {
		const app = setup();
		app.emit('session_start');
		expect(app.get_factory()).toEqual(expect.any(Function));
		app.emit('session_shutdown');
		expect(app.get_factory()).toBeUndefined();
	});

	it.each(['rpc', 'json', 'print'] as const)(
		'does not install or save preferences in %s mode',
		async (mode) => {
			const app = setup(mode);
			app.emit('session_start');
			await app.command('on');
			expect(app.set_editor).not.toHaveBeenCalled();
			expect(write_package_settings).not.toHaveBeenCalled();
		},
	);

	it('keeps another custom editor, including when it replaces this one', async () => {
		const app = setup();
		const other = vi.fn();
		app.set_factory(other);
		app.emit('session_start');
		expect(app.get_factory()).toBe(other);
		await app.command('on');
		expect(app.get_factory()).toBe(other);
		expect(write_package_settings).not.toHaveBeenCalled();
		app.set_factory(undefined);
		await app.command('on');
		app.set_factory(other);
		await app.command('off');
		app.emit('session_shutdown');
		expect(app.get_factory()).toBe(other);
	});

	it('loads preferences and saves on/static/off without reinstalling for static', async () => {
		vi.mocked(read_package_settings).mockReturnValue({ mode: 'off' });
		const app = setup();
		app.emit('session_start');
		const factory = app.get_factory();
		expect(factory).toEqual(expect.any(Function));
		await app.command('on');
		expect(app.get_factory()).toBe(factory);
		await app.command('static');
		expect(app.get_factory()).toBe(factory);
		expect(write_package_settings).toHaveBeenLastCalledWith(
			'pi-starfield',
			{ mode: 'static', suggest: true },
		);
		await app.command('off');
		expect(app.get_factory()).toBe(factory);
		expect(write_package_settings).toHaveBeenLastCalledWith(
			'pi-starfield',
			{ mode: 'off', suggest: true },
		);
	});

	it('restores the default editor only when stars and suggestions are both off', async () => {
		vi.mocked(read_package_settings).mockReturnValue({
			mode: 'off',
			suggest: false,
		});
		const app = setup();
		app.emit('session_start');
		expect(app.get_factory()).toBeUndefined();
		await app.command('suggest on');
		expect(app.get_factory()).toEqual(expect.any(Function));
		await app.command('suggest off');
		expect(app.get_factory()).toBeUndefined();
		await app.command('on');
		const factory = app.get_factory();
		await app.command('suggest on');
		await app.command('suggest off');
		expect(app.get_factory()).toBe(factory);
		await app.command('off');
		expect(app.get_factory()).toBeUndefined();
	});

	it.each([null, { mode: 'invalid' }])(
		'uses defaults for invalid preferences: %j',
		(settings) => {
			vi.mocked(read_package_settings).mockReturnValue(settings);
			const app = setup();
			app.emit('session_start');
			expect(app.get_factory()).toEqual(expect.any(Function));
		},
	);

	it.each(['TERM', 'NO_COLOR'])('respects %s', async (name) => {
		vi.stubEnv(name, name === 'TERM' ? 'dumb' : '1');
		const app = setup();
		app.emit('session_start');
		await app.command('on');
		expect(app.set_editor).not.toHaveBeenCalled();
	});

	it('reports settings write errors without throwing or losing the local choice', async () => {
		vi.mocked(write_package_settings).mockImplementationOnce(() => {
			throw new Error('read only');
		});
		const app = setup();
		app.emit('session_start');
		await app.command('static');
		expect(app.notify).toHaveBeenLastCalledWith(
			expect.stringContaining('could not save settings'),
			'error',
		);
		expect(app.get_factory()).toEqual(expect.any(Function));
	});

	it.each(['on', 'static', 'off'])(
		'asks the session model for a short next prompt with stars %s',
		async (mode) => {
			const app = setup();
			app.emit('session_start');
			await app.command(mode);

			const turn: AgentEndEvent = {
				type: 'agent_end',
				messages: [
					{ role: 'user', content: 'fix the bug', timestamp: 0 },
					make_assistant_message({
						content: [{ type: 'text', text: 'Fixed.' }],
					}),
				],
			};

			app.emit('agent_end', turn);
			expect(app.stream_simple).toHaveBeenCalledWith(
				app.ctx.model,
				expect.objectContaining({ systemPrompt: expect.any(String) }),
				expect.objectContaining({ maxTokens: 60 }),
			);
			await app.command('suggest off');
			expect(write_package_settings).toHaveBeenLastCalledWith(
				'pi-starfield',
				{ mode, suggest: false },
			);
			app.emit('agent_end', turn);
			expect(app.stream_simple).toHaveBeenCalledTimes(1);
		},
	);
});
