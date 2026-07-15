import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	format_resumable_session,
	run_recall_resume,
	supports_resumable_contract,
} from './resume.js';

const { list_resumable_sessions } = vi.hoisted(() => ({
	list_resumable_sessions: vi.fn(),
}));
vi.mock('pirecall/resumable', () => ({
	RESUMABLE_API_SCHEMA_VERSION: 1,
	RESUMABLE_API_CAPABILITIES: [
		'archive-preserving-source-liveness',
		'cwd-scope',
		'server-side-search',
		'pagination',
	],
	list_resumable_sessions,
}));

vi.mock('node:fs', async (import_original) => ({
	...(await import_original<typeof import('node:fs')>()),
	existsSync: vi.fn(),
}));

const session = {
	id: 'session-1',
	path: '/tmp/session-1.jsonl',
	cwd: '/tmp/project',
	name: 'Auth work',
	created_at: '2026-07-01T00:00:00.000Z',
	modified_at: '2026-07-02T00:00:00.000Z',
	message_count: 2,
	first_message: 'Fix authentication',
	source_exists: true as const,
};

function create_ctx(
	options: { has_ui?: boolean; keys?: string[] } = {},
) {
	const notify = vi.fn();
	const switch_session = vi
		.fn()
		.mockResolvedValue({ cancelled: false });
	const request_render = vi.fn();
	const custom = vi.fn(
		(
			factory: (
				tui: { requestRender: () => void },
				theme: {
					fg: (_color: string, text: string) => string;
					bg: (_color: string, text: string) => string;
					bold: (text: string) => string;
				},
				keybindings: {
					matches: (data: string, action: string) => boolean;
				},
				done: (result?: unknown) => void,
			) => { handleInput?: (data: string) => void },
		) =>
			new Promise((resolve) => {
				const component = factory(
					{ requestRender: request_render },
					{
						fg: (_color, text) => text,
						bg: (_color, text) => text,
						bold: (text) => text,
					},
					{
						matches: (data, action) =>
							(data === 'enter' && action === 'tui.select.confirm') ||
							(data === 'escape' && action === 'tui.select.cancel') ||
							(data === 'tab' && action === 'tui.input.tab'),
					},
					resolve,
				);
				for (const [index, key] of (
					options.keys ?? ['enter']
				).entries()) {
					setTimeout(() => component.handleInput?.(key), index * 5);
				}
			}),
	);
	return {
		ctx: {
			cwd: '/tmp/project',
			hasUI: options.has_ui ?? true,
			ui: { notify, custom },
			switchSession: switch_session,
		} as unknown as ExtensionCommandContext,
		notify,
		switch_session,
		custom,
	};
}

afterEach(() => {
	vi.clearAllMocks();
});

describe('resumable contract', () => {
	it('requires schema v1 and every picker capability', () => {
		expect(
			supports_resumable_contract({
				schema_version: 1,
				capabilities: [
					'archive-preserving-source-liveness',
					'cwd-scope',
					'server-side-search',
					'pagination',
				],
			}),
		).toBe(true);
		expect(
			supports_resumable_contract({
				schema_version: 2,
				capabilities: [],
			}),
		).toBe(false);
	});

	it('formats picker rows with stable unique indexes', () => {
		expect(format_resumable_session(session, 4)).toContain(
			'5. Auth work',
		);
		expect(format_resumable_session(session, 4)).toContain(
			'/tmp/project',
		);
	});
});

describe('run_recall_resume', () => {
	it('searches the published API and switches through Pi', async () => {
		list_resumable_sessions.mockResolvedValue({
			schema_version: 1,
			capabilities: [
				'archive-preserving-source-liveness',
				'cwd-scope',
				'server-side-search',
				'pagination',
			],
			sessions: [session],
		});
		vi.mocked(existsSync).mockReturnValue(true);
		const { ctx, switch_session } = create_ctx();

		await run_recall_resume('auth', ctx);

		expect(list_resumable_sessions).toHaveBeenCalledWith({
			scope: 'project',
			cwd: '/tmp/project',
			query: 'auth',
			limit: 50,
			offset: 0,
		});
		expect(switch_session).toHaveBeenCalledWith(session.path);
	});

	it('toggles between project and all-session scope with tab', async () => {
		list_resumable_sessions.mockResolvedValue({
			schema_version: 1,
			capabilities: [
				'archive-preserving-source-liveness',
				'cwd-scope',
				'server-side-search',
				'pagination',
			],
			sessions: [session],
		});
		const { ctx, switch_session } = create_ctx({
			keys: ['tab', 'escape'],
		});

		await run_recall_resume('', ctx);

		expect(list_resumable_sessions).toHaveBeenCalledWith(
			expect.objectContaining({ scope: 'all', cwd: undefined }),
		);
		expect(switch_session).not.toHaveBeenCalled();
	});

	it('checks the source again before switching', async () => {
		list_resumable_sessions.mockResolvedValue({
			schema_version: 1,
			capabilities: [
				'archive-preserving-source-liveness',
				'cwd-scope',
				'server-side-search',
				'pagination',
			],
			sessions: [session],
		});
		vi.mocked(existsSync).mockReturnValue(false);
		const { ctx, notify, switch_session } = create_ctx();

		await run_recall_resume('auth', ctx);

		expect(switch_session).not.toHaveBeenCalled();
		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining('no longer available'),
			'warning',
		);
	});

	it('falls back to native resume for incompatible APIs', async () => {
		list_resumable_sessions.mockResolvedValue({
			schema_version: 2,
			capabilities: [],
			sessions: [],
		});
		const { ctx, notify } = create_ctx();

		await run_recall_resume('', ctx);

		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining(
				"Run /resume to use Pi's native picker",
			),
			'warning',
		);
	});
});
