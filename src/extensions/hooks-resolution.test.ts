import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	build_hook_payload,
	create_hooks_resolution_extension,
	load_hooks,
	matches_hook,
	parse_claude_settings_hooks,
	to_claude_tool_name,
	type CommandRunResult,
	type HookState,
} from './hooks-resolution.js';

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function create_temp_dir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'my-pi-hooks-'));
	dirs.push(dir);
	return dir;
}

function create_test_pi() {
	const events = new Map<string, any>();
	const pi = {
		on(name: string, handler: any) {
			events.set(name, handler);
		},
	} as unknown as ExtensionAPI;
	return { pi, events };
}

function create_context(overrides: Partial<any> = {}) {
	const notify = vi.fn();
	return {
		ctx: {
			cwd: '/repo',
			hasUI: true,
			ui: { notify },
			sessionManager: {
				getSessionFile: vi.fn().mockReturnValue('session.jsonl'),
			},
			...overrides,
		},
		notify,
	};
}

describe('hooks-resolution helpers', () => {
	it('parses Claude settings command hooks', () => {
		const hooks = parse_claude_settings_hooks(
			{
				hooks: {
					PostToolUse: [
						{
							matcher: 'Write|Edit',
							hooks: [
								{
									type: 'command',
									command: 'echo ok',
								},
							],
						},
					],
				},
			},
			'/repo/.claude/settings.json',
			'/repo',
		);

		expect(hooks).toHaveLength(1);
		expect(hooks[0].event_name).toBe('PostToolUse');
		expect(hooks[0].command).toBe('echo ok');
		expect(hooks[0].matcher?.test('Write')).toBe(true);
	});

	it('loads hooks from .claude and .pi config files', () => {
		const dir = create_temp_dir();
		mkdirSync(join(dir, '.git'));
		mkdirSync(join(dir, '.claude'));
		mkdirSync(join(dir, '.pi'));

		writeFileSync(
			join(dir, '.claude', 'settings.json'),
			JSON.stringify({
				hooks: {
					PostToolUse: [
						{
							matcher: 'Write',
							hooks: [{ type: 'command', command: 'echo claude' }],
						},
					],
				},
			}),
		);
		writeFileSync(
			join(dir, '.pi', 'hooks.json'),
			JSON.stringify({
				hooks: {
					PostToolUseFailure: [
						{ matcher: 'Bash', command: 'echo pi' },
					],
				},
			}),
		);

		const state = load_hooks(dir);
		expect(state.project_dir).toBe(dir);
		expect(state.hooks).toHaveLength(2);
		expect(state.hooks.map((hook) => hook.command)).toEqual([
			'echo claude',
			'echo pi',
		]);
	});

	it('matches Claude-style and Pi-style tool names', () => {
		expect(to_claude_tool_name('ls')).toBe('LS');
		expect(to_claude_tool_name('write')).toBe('Write');
		expect(
			matches_hook(
				{
					event_name: 'PostToolUse',
					matcher: /Write/,
					matcher_text: 'Write',
					command: 'echo ok',
					source: 'test',
				},
				'write',
			),
		).toBe(true);
	});

	it('builds Claude-compatible hook payloads', () => {
		const { ctx } = create_context();
		const payload = build_hook_payload(
			{
				toolName: 'write',
				toolCallId: 'call-1',
				input: { path: 'src/file.ts', content: 'x' },
				content: [{ type: 'text', text: 'done' }],
				isError: false,
				details: null,
			} as any,
			'PostToolUse',
			ctx as any,
			'/repo',
		);

		expect(payload.tool_name).toBe('Write');
		expect(payload.tool_input).toMatchObject({
			path: 'src/file.ts',
			file_path: 'src/file.ts',
			filePath: 'src/file.ts',
		});
		expect(payload.tool_response).toMatchObject({
			is_error: false,
			isError: false,
			text: 'done',
		});
	});
});

describe('hooks-resolution extension', () => {
	it('runs matching hooks once per unique command and notifies on success', async () => {
		const { pi, events } = create_test_pi();
		const run_command_hook = vi
			.fn<
				(
					command: string,
					cwd: string,
					payload: Record<string, unknown>,
				) => Promise<CommandRunResult>
			>()
			.mockResolvedValue({
				code: 0,
				stdout: '',
				stderr: '',
				elapsed_ms: 12,
				timed_out: false,
			});
		const load_hooks_impl = vi
			.fn<(cwd: string) => HookState>()
			.mockReturnValue({
				project_dir: '/repo',
				hooks: [
					{
						event_name: 'PostToolUse',
						matcher: /Write/,
						matcher_text: 'Write',
						command: 'echo same',
						source: 'a',
					},
					{
						event_name: 'PostToolUse',
						matcher: /Write/,
						matcher_text: 'Write',
						command: 'echo same',
						source: 'b',
					},
				],
			});

		await create_hooks_resolution_extension({
			load_hooks: load_hooks_impl,
			run_command_hook,
		})(pi);

		const start = events.get('session_start');
		const tool_result = events.get('tool_result');
		const { ctx, notify } = create_context();

		await start({}, ctx);
		await tool_result(
			{
				toolName: 'write',
				toolCallId: 'call-1',
				input: { path: 'src/file.ts' },
				content: [{ type: 'text', text: 'done' }],
				isError: false,
				details: null,
			} as any,
			ctx,
		);

		expect(load_hooks_impl).toHaveBeenCalledWith('/repo');
		expect(run_command_hook).toHaveBeenCalledTimes(1);
		expect(run_command_hook.mock.calls[0][0]).toBe('echo same');
		expect(notify).toHaveBeenCalledWith(
			'Hook `echo` ran (12ms)',
			'info',
		);
	});
});
