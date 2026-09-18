import type {
	ExtensionContext,
	ReadonlyFooterDataProvider,
} from '@earendil-works/pi-coding-agent';
import { vi } from 'vite-plus/test';
import type { FooterTheme } from './theme/tokens.js';

export const test_theme = {
	fg: vi.fn(
		(color: string, text: string) => `<${color}>${text}</${color}>`,
	),
	bold: vi.fn((text: string) => `**${text}**`),
} as unknown as FooterTheme;

export function make_footer_data(
	overrides: Partial<ReadonlyFooterDataProvider> = {},
): ReadonlyFooterDataProvider {
	return {
		getGitBranch: vi.fn(() => 'main'),
		getAvailableProviderCount: vi.fn(() => 1),
		getExtensionStatuses: vi.fn(() => new Map()),
		onBranchChange: vi.fn(() => vi.fn()),
		...overrides,
	} as unknown as ReadonlyFooterDataProvider;
}

export function make_context(
	overrides: Record<string, unknown> = {},
): ExtensionContext {
	return {
		hasUI: true,
		cwd: '/home/scott/repos/my-pi',
		model: {
			id: 'claude-sonnet',
			provider: 'anthropic',
			contextWindow: 200_000,
			reasoning: true,
		},
		modelRegistry: {
			isUsingOAuth: vi.fn(() => false),
		},
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
	} as unknown as ExtensionContext;
}
