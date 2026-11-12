import {
	make_context as sdk_context,
	make_model,
	make_model_registry,
	make_theme,
	type ContextOverrides,
} from '../../../tools/test-sdk.js';
import type {
	ExtensionContext,
	ReadonlyFooterDataProvider,
} from '@earendil-works/pi-coding-agent';
import { vi } from 'vite-plus/test';
import type { FooterTheme } from './theme/tokens.js';

export const test_theme: FooterTheme = make_theme();

vi.spyOn(test_theme, 'fg').mockImplementation(
	(color, text) => `<${color}>${text}</${color}>`,
);

vi.spyOn(test_theme, 'bold').mockImplementation(
	(text) => `**${text}**`,
);

export function make_footer_data(
	overrides: Partial<ReadonlyFooterDataProvider> = {},
): ReadonlyFooterDataProvider {
	return {
		getGitBranch: vi.fn(() => 'main'),
		getAvailableProviderCount: vi.fn(() => 1),
		getExtensionStatuses: vi.fn(() => new Map()),
		onBranchChange: vi.fn(() => vi.fn()),
		...overrides,
	} as ReadonlyFooterDataProvider;
}

export function make_context(
	overrides: ContextOverrides = {},
): ExtensionContext {
	return sdk_context({
		hasUI: true,
		cwd: '/home/scott/repos/my-pi',
		model: make_model({ id: 'claude-sonnet' }),
		modelRegistry: make_model_registry({
			isUsingOAuth: vi.fn(() => false),
		}),
		sessionManager: {
			getEntries: vi.fn(() => []),
			getSessionName: vi.fn(() => 'test-session'),
		},
		getContextUsage: vi.fn(() => ({
			tokens: 50_000,
			contextWindow: 200_000,
			percent: 25,
		})),
		ui: {
			theme: test_theme,
			setFooter: vi.fn(),
			setStatus: vi.fn(),
			notify: vi.fn(),
		},
		...overrides,
	});
}
