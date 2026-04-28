import { describe, expect, it } from 'vitest';
import {
	apply_untrusted_repo_defaults,
	get_force_disabled_builtins,
	is_project_local_skill_path,
} from './api.js';

describe('get_force_disabled_builtins', () => {
	const enabled = {
		mcp: true,
		skills: true,
		filter_output: true,
		recall: true,
		nopeek: true,
		omnisearch: true,
		sqlite_tools: true,
		prompt_presets: true,
		lsp: true,
		session_name: true,
		confirm_destructive: true,
		hooks_resolution: true,
	} as const;

	it('keeps UI-only built-ins enabled in interactive mode', () => {
		const disabled = get_force_disabled_builtins({
			...enabled,
			runtime_mode: 'interactive',
		});

		expect(disabled.has('session-name')).toBe(false);
		expect(disabled.has('confirm-destructive')).toBe(false);
	});

	it('disables UI-only built-ins in print mode', () => {
		const disabled = get_force_disabled_builtins({
			...enabled,
			runtime_mode: 'print',
		});

		expect(disabled.has('session-name')).toBe(true);
		expect(disabled.has('confirm-destructive')).toBe(false);
		expect(disabled.has('mcp')).toBe(false);
		expect(disabled.has('prompt-presets')).toBe(false);
		expect(disabled.has('lsp')).toBe(false);
	});

	it('still respects explicit CLI disables', () => {
		const disabled = get_force_disabled_builtins({
			...enabled,
			runtime_mode: 'json',
			mcp: false,
			recall: false,
		});

		expect(disabled.has('mcp')).toBe(true);
		expect(disabled.has('recall')).toBe(true);
		expect(disabled.has('nopeek')).toBe(false);
		expect(disabled.has('omnisearch')).toBe(false);
		expect(disabled.has('sqlite-tools')).toBe(false);
	});
});

describe('apply_untrusted_repo_defaults', () => {
	it('sets conservative project-resource defaults without overriding explicit enables', () => {
		const env: NodeJS.ProcessEnv = {
			MY_PI_MCP_PROJECT_CONFIG: 'allow',
		};

		expect(apply_untrusted_repo_defaults(env)).toEqual([
			'MY_PI_HOOKS_CONFIG',
			'MY_PI_LSP_PROJECT_BINARY',
			'MY_PI_PROMPT_PRESETS_PROJECT',
			'MY_PI_PROJECT_SKILLS',
			'MY_PI_CHILD_ENV_ALLOWLIST',
			'MY_PI_MCP_ENV_ALLOWLIST',
			'MY_PI_HOOKS_ENV_ALLOWLIST',
		]);
		expect(env).toMatchObject({
			MY_PI_MCP_PROJECT_CONFIG: 'allow',
			MY_PI_HOOKS_CONFIG: 'skip',
			MY_PI_LSP_PROJECT_BINARY: 'global',
			MY_PI_PROMPT_PRESETS_PROJECT: 'skip',
			MY_PI_PROJECT_SKILLS: 'skip',
			MY_PI_CHILD_ENV_ALLOWLIST: '',
			MY_PI_MCP_ENV_ALLOWLIST: '',
			MY_PI_HOOKS_ENV_ALLOWLIST: '',
		});
	});
});

describe('is_project_local_skill_path', () => {
	it('detects project-local .pi and .claude skills only', () => {
		expect(
			is_project_local_skill_path(
				'/repo',
				'/repo/.pi/skills/local/SKILL.md',
			),
		).toBe(true);
		expect(
			is_project_local_skill_path(
				'/repo',
				'/repo/.claude/skills/local/SKILL.md',
			),
		).toBe(true);
		expect(
			is_project_local_skill_path(
				'/repo',
				'/home/scott/.pi/agent/skills/global/SKILL.md',
			),
		).toBe(false);
		expect(
			is_project_local_skill_path(
				'/repo',
				'/repo/packages/pi-skills/src/SKILL.md',
			),
		).toBe(false);
	});
});
