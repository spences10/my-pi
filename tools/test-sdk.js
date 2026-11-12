// @ts-check
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import {
	ModelRegistry,
	ModelRuntime,
	SessionManager,
	Theme,
	createEventBus,
} from '@earendil-works/pi-coding-agent';
import {
	KeybindingsManager as TuiKeybindingsManager,
	TUI_KEYBINDINGS,
} from '@earendil-works/pi-tui';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vite-plus/test';
import { make_tui } from './test-terminal.js';

// Unique, nonexistent paths keep fixtures away from the user's credentials and caches.
const isolated_dir = join(
	tmpdir(),
	`my-pi-sdk-fixture-${randomUUID()}`,
);

const runtime = await ModelRuntime.create({
	authPath: join(isolated_dir, 'auth.json'),
	modelsPath: null,
	modelsStorePath: join(isolated_dir, 'models.json'),
	allowModelNetwork: false,
	refreshOnCreate: false,
});

/**
 * @param {Partial<ConstructorParameters<typeof Theme>[0]>} foreground
 * @param {Partial<ConstructorParameters<typeof Theme>[1]>} background
 * @param {import('@earendil-works/pi-tui').TerminalColorMode} mode
 */
export function make_theme(
	foreground = {},
	background = {},
	mode = 'truecolor',
) {
	return new Theme(
		{
			accent: '',
			border: '',
			borderAccent: '',
			borderMuted: '',
			success: '',
			error: '',
			warning: '',
			muted: '',
			dim: '',
			text: '',
			thinkingText: '',
			scrollbarTrack: '',
			scrollbarThumb: '',
			searchMatchText: '',
			userMessageText: '',
			customMessageText: '',
			customMessageLabel: '',
			toolTitle: '',
			toolOutput: '',
			mdHeading: '',
			mdLink: '',
			mdLinkUrl: '',
			mdCode: '',
			mdCodeBlock: '',
			mdCodeBlockBorder: '',
			mdQuote: '',
			mdQuoteBorder: '',
			mdHr: '',
			mdListBullet: '',
			toolDiffAdded: '',
			toolDiffRemoved: '',
			toolDiffContext: '',
			syntaxComment: '',
			syntaxKeyword: '',
			syntaxFunction: '',
			syntaxVariable: '',
			syntaxString: '',
			syntaxNumber: '',
			syntaxType: '',
			syntaxOperator: '',
			syntaxPunctuation: '',
			thinkingOff: '',
			thinkingMinimal: '',
			thinkingLow: '',
			thinkingMedium: '',
			thinkingHigh: '',
			thinkingXhigh: '',
			thinkingMax: '',
			bashMode: '',
			...foreground,
		},
		{
			selectedBg: '',
			searchMatchBg: '',
			userMessageBg: '',
			customMessageBg: '',
			toolPendingBg: '',
			toolSuccessBg: '',
			toolErrorBg: '',
			...background,
		},
		mode,
	);
}

/** @param {string[][]} steps
 * @returns {import('@earendil-works/pi-coding-agent').ExtensionUIContext['custom']}
 */
export function make_custom_ui(steps) {
	/** @template T
	 * @param {import('./test-sdk-types.js').CustomFactory<T>} factory
	 * @returns {Promise<T>}
	 */
	async function custom(factory) {
		let finished = false;
		/** @type {(value: T) => void} */
		let finish = () => {};
		/** @type {Promise<T>} */

		const result = new Promise((resolve) => {
			finish = resolve;
		});

		const component = await factory(
			make_tui().tui,
			make_theme(),
			make_keybindings(),
			(value) => {
				finished = true;
				finish(value);
			},
		);

		try {
			const keys = steps.shift();

			if (!keys) throw new Error('Unexpected custom UI call');
			component.render(100);

			for (const key of keys) {
				await new Promise((resolve) => setTimeout(resolve, 5));
				component.handleInput?.(key);
			}

			if (!finished)
				throw new Error('Custom UI did not finish through done()');

			return result;
		} finally {
			component.dispose?.();
		}
	}

	return custom;
}

/** @param {import('@earendil-works/pi-tui').KeybindingDefinitions} definitions
 * @returns {import('@earendil-works/pi-coding-agent').KeybindingsManager}
 */
export function make_keybindings(definitions = TUI_KEYBINDINGS) {
	/** @type {Pick<import('@earendil-works/pi-coding-agent').KeybindingsManager, keyof import('@earendil-works/pi-coding-agent').KeybindingsManager>} */
	const keybindings = Object.assign(
		new TuiKeybindingsManager(definitions),
		{
			reload: vi.fn(),
			getEffectiveConfig: () => keybindings.getResolvedBindings(),
		},
	);

	// SAFETY: the SDK exposes its subclass only as a type. The real base owns all keybinding state;
	// the complete public subclass contract is supplied without reading a user's config file.
	return /** @type {import('@earendil-works/pi-coding-agent').KeybindingsManager} */ (
		keybindings
	);
}

/** @param {Partial<import('@earendil-works/pi-ai').AssistantMessage>} overrides
 * @returns {import('@earendil-works/pi-ai').AssistantMessage}
 */
export function make_assistant_message(overrides = {}) {
	return {
		role: 'assistant',
		content: [],
		api: 'anthropic-messages',
		provider: 'anthropic',
		model: 'test-model',
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
		},
		stopReason: 'stop',
		timestamp: 0,
		...overrides,
	};
}

/** @param {() => Promise<import('@earendil-works/pi-ai').AssistantMessage>} result */
export function make_stream(result) {
	const stream = createAssistantMessageEventStream();
	vi.spyOn(stream, 'result').mockImplementation(result);

	return stream;
}

/** @param {Partial<NonNullable<import('@earendil-works/pi-coding-agent').ExtensionContext['model']>>} overrides
 * @returns {NonNullable<import('@earendil-works/pi-coding-agent').ExtensionContext['model']>}
 */
export function make_model(overrides = {}) {
	return {
		id: 'test-model',
		name: 'Test Model',
		api: 'anthropic-messages',
		provider: 'anthropic',
		baseUrl: 'https://example.invalid',
		reasoning: true,
		input: ['text'],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 4096,
		...overrides,
	};
}

/** @param {Partial<Pick<ModelRegistry, keyof ModelRegistry>>} overrides */
export function make_model_registry(overrides = {}) {
	return Object.assign(new ModelRegistry(runtime), overrides);
}

/**
 * @param {Partial<import('@earendil-works/pi-coding-agent').ExtensionAPI>} overrides
 * @returns {import('@earendil-works/pi-coding-agent').ExtensionAPI}
 */
export function make_api(overrides = {}) {
	return {
		on: vi.fn(() => vi.fn()),
		registerTool: vi.fn(),
		registerCommand: vi.fn(),
		registerShortcut: vi.fn(),
		registerFlag: vi.fn(),
		getFlag: vi.fn(),
		registerMessageRenderer: vi.fn(),
		registerMarkdownTransformer: vi.fn(),
		registerEntryRenderer: vi.fn(),
		registerToolRenderer: vi.fn(),
		sendMessage: vi.fn(),
		sendUserMessage: vi.fn(),
		appendEntry: vi.fn(),
		setSessionName: vi.fn(),
		getSessionName: vi.fn(),
		setLabel: vi.fn(),
		exec: vi.fn(async () => ({
			stdout: '',
			stderr: '',
			code: 0,
			killed: false,
			truncated: false,
		})),
		getActiveTools: vi.fn(() => []),
		getAllTools: vi.fn(() => []),
		getSettings: vi.fn(() => ({})),
		setActiveTools: vi.fn(),
		getCommands: vi.fn(() => []),
		setModel: vi.fn(async () => true),
		getThinkingLevel: vi.fn(() => /** @type {const} */ ('off')),
		setThinkingLevel: vi.fn(),
		registerProvider: vi.fn(),
		unregisterProvider: vi.fn(),
		registerMcpServer: vi.fn(),
		unregisterMcpServer: vi.fn(),
		getMcpServers: vi.fn(() => []),
		registerVirtualModel: vi.fn(),
		unregisterVirtualModel: vi.fn(),
		events: createEventBus(),
		...overrides,
	};
}

/**
 * @param {Partial<import('@earendil-works/pi-coding-agent').ExtensionUIContext>} overrides
 * @returns {import('@earendil-works/pi-coding-agent').ExtensionUIContext}
 */
export function make_ui(overrides = {}) {
	return {
		select: vi.fn(async () => undefined),
		confirm: vi.fn(async () => false),
		input: vi.fn(async () => undefined),
		notify: vi.fn(),
		onTerminalInput: vi.fn(() => vi.fn()),
		setStatus: vi.fn(),
		setWorkingMessage: vi.fn(),
		setWorkingVisible: vi.fn(),
		setWorkingIndicator: vi.fn(),
		setHiddenThinkingLabel: vi.fn(),
		setWidget: vi.fn(),
		setFooter: vi.fn(),
		setHeader: vi.fn(),
		setTitle: vi.fn(),
		custom: vi.fn(async () => {
			throw new Error('Custom UI must be configured by the test');
		}),
		pasteToEditor: vi.fn(),
		setEditorText: vi.fn(),
		getEditorText: vi.fn(() => ''),
		editor: vi.fn(async () => undefined),
		addAutocompleteProvider: vi.fn(),
		setEditorComponent: vi.fn(),
		getEditorComponent: vi.fn(),
		theme: make_theme(),
		getAllThemes: vi.fn(() => []),
		getTheme: vi.fn(),
		setTheme: vi.fn(() => ({ success: true })),
		getToolsExpanded: vi.fn(() => false),
		setToolsExpanded: vi.fn(),
		...overrides,
	};
}

/**
 * @param {import('./test-sdk-types.js').ContextOverrides} overrides
 * @returns {import('@earendil-works/pi-coding-agent').ExtensionContext}
 */
export function make_context(overrides = {}) {
	const { ui, sessionManager, modelRegistry, ...rest } = overrides;

	return {
		mode: 'tui',
		hasUI: true,
		cwd: '/repo',
		model: undefined,
		modelRegistry: make_model_registry(modelRegistry),
		scopedModels: [],
		signal: undefined,
		isIdle: vi.fn(() => true),
		isProjectTrusted: vi.fn(() => true),
		abort: vi.fn(),
		hasPendingMessages: vi.fn(() => false),
		shutdown: vi.fn(),
		getContextUsage: vi.fn(),
		compact: vi.fn(),
		getSystemPrompt: vi.fn(() => ''),
		...rest,
		ui: make_ui(ui),
		sessionManager: Object.assign(
			SessionManager.inMemory(rest.cwd ?? '/repo'),
			sessionManager,
		),
	};
}

/** @param {import('./test-sdk-types.js').ContextOverrides} overrides
 * @returns {import('@earendil-works/pi-coding-agent').ExtensionToolContext}
 */
export function make_tool_context(overrides = {}) {
	return {
		...make_context(overrides),
		tools: [],
		executeTool: vi.fn(async () => {
			throw new Error('Nested tools must be configured by the test');
		}),
	};
}

/**
 * @param {import('./test-sdk-types.js').ContextOverrides & Partial<Omit<import('@earendil-works/pi-coding-agent').ExtensionCommandContext, keyof import('@earendil-works/pi-coding-agent').ExtensionContext>>} overrides
 * @returns {import('@earendil-works/pi-coding-agent').ExtensionCommandContext}
 */
export function make_command_context(overrides = {}) {
	const { ui, sessionManager, modelRegistry, ...command_overrides } =
		overrides;

	return {
		getSystemPromptOptions: vi.fn(() => ({
			cwd: overrides.cwd ?? '/repo',
		})),
		waitForIdle: vi.fn(async () => {}),
		newSession: vi.fn(async () => ({ cancelled: false })),
		fork: vi.fn(async () => ({ cancelled: false })),
		navigateTree: vi.fn(async () => ({ cancelled: false })),
		switchSession: vi.fn(async () => ({ cancelled: false })),
		reload: vi.fn(async () => {}),
		...make_context({
			...command_overrides,
			ui,
			sessionManager,
			modelRegistry,
		}),
		...command_overrides,
	};
}
