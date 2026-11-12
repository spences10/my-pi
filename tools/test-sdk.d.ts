import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionUIContext,
	Theme,
} from '@earendil-works/pi-coding-agent';

import type { ContextOverrides } from './test-sdk-types.js';

export type { ContextOverrides } from './test-sdk-types.js';

export function make_custom_ui(
	steps: string[][],
): ExtensionUIContext['custom'];
export function make_keybindings(
	definitions?: import('@earendil-works/pi-tui').KeybindingDefinitions,
): import('@earendil-works/pi-coding-agent').KeybindingsManager;
export function make_assistant_message(
	overrides?: Partial<
		import('@earendil-works/pi-ai').AssistantMessage
	>,
): import('@earendil-works/pi-ai').AssistantMessage;
export function make_stream(
	result: () => Promise<
		import('@earendil-works/pi-ai').AssistantMessage
	>,
): import('@earendil-works/pi-ai').AssistantMessageEventStream;
export function make_model(
	overrides?: Partial<NonNullable<ExtensionContext['model']>>,
): NonNullable<ExtensionContext['model']>;
export function make_model_registry(
	overrides?: Partial<
		Pick<
			ExtensionContext['modelRegistry'],
			keyof ExtensionContext['modelRegistry']
		>
	>,
): ExtensionContext['modelRegistry'];
export function make_api(
	overrides?: Partial<ExtensionAPI>,
): ExtensionAPI;
export function make_ui(
	overrides?: Partial<ExtensionUIContext>,
): ExtensionUIContext;
export function make_context(
	overrides?: ContextOverrides,
): ExtensionContext;
export function make_tool_context(
	overrides?: ContextOverrides,
): import('@earendil-works/pi-coding-agent').ExtensionToolContext;
export function make_command_context(
	overrides?: ContextOverrides &
		Partial<Omit<ExtensionCommandContext, keyof ExtensionContext>>,
): ExtensionCommandContext;
export function make_theme(
	foreground?: Partial<ConstructorParameters<typeof Theme>[0]>,
	background?: Partial<ConstructorParameters<typeof Theme>[1]>,
	mode?: ConstructorParameters<typeof Theme>[2],
): Theme;
