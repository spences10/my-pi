import {
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	apply_project_trust_untrusted_defaults,
	is_project_subject_trusted,
	normalize_project_trust_env_decision,
	read_project_trust_store,
	resolve_project_trust,
	trust_project_subject,
	type ProjectTrustSubject,
} from './index.js';

const files: string[] = [];

function trust_store_path(): string {
	const path = join(
		tmpdir(),
		`my-pi-project-trust-${process.pid}-${Date.now()}-${files.length}`,
		'trust.json',
	);
	files.push(path);
	return path;
}

function subject(
	overrides: Partial<ProjectTrustSubject> = {},
): ProjectTrustSubject {
	return {
		kind: 'mcp-config',
		id: '/repo/mcp.json',
		hash: 'hash-a',
		env_key: 'MY_PI_MCP_PROJECT_CONFIG',
		prompt_title: 'Trust project MCP config?',
		summary_lines: ['- demo: stdio demo'],
		...overrides,
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	for (const file of files.splice(0)) {
		rmSync(file, { force: true });
		rmSync(dirname(file), { force: true, recursive: true });
	}
});

describe('normalize_project_trust_env_decision', () => {
	it.each(['1', 'true', 'yes', 'allow', ' ALLOW '])(
		'normalizes %s as allow-once',
		(value) => {
			expect(normalize_project_trust_env_decision(value)).toEqual({
				action: 'allow-once',
			});
		},
	);

	it('normalizes trust as persisted trust', () => {
		expect(normalize_project_trust_env_decision('trust')).toEqual({
			action: 'trust-persisted',
		});
	});

	it.each(['0', 'false', 'no', 'skip', 'disable'])(
		'normalizes %s as skip',
		(value) => {
			expect(normalize_project_trust_env_decision(value)).toEqual({
				action: 'skip',
			});
		},
	);

	it('normalizes global aliases only when a global fallback exists', () => {
		expect(
			normalize_project_trust_env_decision('global'),
		).toBeUndefined();
		expect(
			normalize_project_trust_env_decision('global-only', {
				fallback: 'global',
			}),
		).toEqual({ action: 'fallback', fallback: 'global' });
	});

	it('ignores empty and unknown values', () => {
		expect(
			normalize_project_trust_env_decision(undefined),
		).toBeUndefined();
		expect(normalize_project_trust_env_decision('')).toBeUndefined();
		expect(
			normalize_project_trust_env_decision('maybe'),
		).toBeUndefined();
	});
});

describe('apply_project_trust_untrusted_defaults', () => {
	it('sets conservative project-resource defaults without overriding explicit choices', () => {
		const env: NodeJS.ProcessEnv = {
			MY_PI_MCP_PROJECT_CONFIG: 'allow',
		};

		expect(apply_project_trust_untrusted_defaults(env)).toEqual([
			'MY_PI_HOOKS_CONFIG',
			'MY_PI_LSP_PROJECT_BINARY',
			'MY_PI_PROMPT_PRESETS_PROJECT',
			'MY_PI_PROJECT_SKILLS',
			'MY_PI_TEAM_PROFILES_PROJECT',
		]);
		expect(env).toMatchObject({
			MY_PI_MCP_PROJECT_CONFIG: 'allow',
			MY_PI_HOOKS_CONFIG: 'skip',
			MY_PI_LSP_PROJECT_BINARY: 'global',
			MY_PI_PROMPT_PRESETS_PROJECT: 'skip',
			MY_PI_PROJECT_SKILLS: 'skip',
			MY_PI_TEAM_PROFILES_PROJECT: 'skip',
		});
	});
});

describe('project trust store helpers', () => {
	it('persists hash-based trust and invalidates changed hashes', () => {
		const store = trust_store_path();
		const trusted = subject();

		expect(is_project_subject_trusted(trusted, store)).toBe(false);
		trust_project_subject(
			trusted,
			store,
			new Date('2026-04-30T00:00:00.000Z'),
		);

		expect(is_project_subject_trusted(trusted, store)).toBe(true);
		expect(
			is_project_subject_trusted(
				{ ...trusted, hash: 'hash-b' },
				store,
			),
		).toBe(false);
		expect(readFileSync(store, 'utf8')).toContain('trusted_at');
		expect(statSync(store).mode & 0o777).toBe(0o600);
	});

	it('supports path-only trust for current LSP binary semantics', () => {
		const store = trust_store_path();
		const lsp = subject({
			kind: 'lsp-binary',
			id: '/repo/node_modules/.bin/svelteserver',
			hash: undefined,
			env_key: 'MY_PI_LSP_PROJECT_BINARY',
			prompt_title: 'Trust project-local LSP binary?',
		});

		trust_project_subject(lsp, store);

		expect(is_project_subject_trusted(lsp, store)).toBe(true);
		expect(
			is_project_subject_trusted(
				{ ...lsp, id: `${lsp.id}-other` },
				store,
			),
		).toBe(false);
	});

	it('returns an empty store for corrupt JSON', () => {
		const store = trust_store_path();
		mkdirSync(dirname(store), { recursive: true });
		writeFileSync(store, 'not json');

		expect(read_project_trust_store(store)).toEqual({});
	});
});

describe('resolve_project_trust', () => {
	it('returns missing skip for absent subjects', async () => {
		await expect(resolve_project_trust(undefined)).resolves.toEqual({
			action: 'skip',
			reason: 'missing',
			metadata_trusted: false,
		});
	});

	it('lets persisted trust win before env decisions', async () => {
		const store = trust_store_path();
		const trusted = subject();
		trust_project_subject(trusted, store);

		await expect(
			resolve_project_trust(trusted, {
				trust_store_path: store,
				env: { MY_PI_MCP_PROJECT_CONFIG: 'skip' },
			}),
		).resolves.toEqual({
			action: 'trust-persisted',
			reason: 'persisted',
			metadata_trusted: true,
		});
	});

	it('env trust persists and returns trusted metadata', async () => {
		const store = trust_store_path();
		const target = subject();

		await expect(
			resolve_project_trust(target, {
				trust_store_path: store,
				env: { MY_PI_MCP_PROJECT_CONFIG: 'trust' },
			}),
		).resolves.toEqual({
			action: 'trust-persisted',
			reason: 'env',
			metadata_trusted: true,
		});
		expect(is_project_subject_trusted(target, store)).toBe(true);
	});

	it('env allow returns allow-once without persisting trust', async () => {
		const store = trust_store_path();
		const target = subject();

		await expect(
			resolve_project_trust(target, {
				trust_store_path: store,
				env: { MY_PI_MCP_PROJECT_CONFIG: 'allow' },
			}),
		).resolves.toEqual({
			action: 'allow-once',
			reason: 'env',
			metadata_trusted: false,
		});
		expect(is_project_subject_trusted(target, store)).toBe(false);
	});

	it('env skip returns skip before UI', async () => {
		const select = vi.fn();

		await expect(
			resolve_project_trust(subject(), {
				env: { MY_PI_MCP_PROJECT_CONFIG: 'skip' },
				has_ui: true,
				select,
			}),
		).resolves.toEqual({
			action: 'skip',
			reason: 'env',
			metadata_trusted: false,
		});
		expect(select).not.toHaveBeenCalled();
	});

	it('headless no-env skips and warns for non-fallback resources', async () => {
		const warn = vi.fn();

		await expect(
			resolve_project_trust(subject(), {
				env: {},
				has_ui: false,
				warn,
			}),
		).resolves.toEqual({
			action: 'skip',
			reason: 'headless',
			metadata_trusted: false,
		});
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('Set MY_PI_MCP_PROJECT_CONFIG=allow'),
		);
	});

	it('headless no-env uses configured fallback for LSP-style resources', async () => {
		await expect(
			resolve_project_trust(
				subject({
					kind: 'lsp-binary',
					hash: undefined,
					env_key: 'MY_PI_LSP_PROJECT_BINARY',
					fallback: 'global',
				}),
				{ env: {}, has_ui: false, warn: vi.fn() },
			),
		).resolves.toEqual({
			action: 'fallback',
			fallback: 'global',
			reason: 'headless',
			metadata_trusted: false,
		});
	});

	it('UI choices map to allow, trust, and fallback', async () => {
		const store = trust_store_path();
		const lsp = subject({
			kind: 'lsp-binary',
			hash: undefined,
			env_key: 'MY_PI_LSP_PROJECT_BINARY',
			fallback: 'global',
			choices: {
				allow_once: 'Allow once for this session',
				trust: 'Trust this binary path',
				skip: 'Use global PATH binary instead',
			},
		});

		await expect(
			resolve_project_trust(lsp, {
				trust_store_path: store,
				env: {},
				has_ui: true,
				select: async () => 'Allow once for this session',
			}),
		).resolves.toMatchObject({
			action: 'allow-once',
			reason: 'user',
		});

		await expect(
			resolve_project_trust(lsp, {
				trust_store_path: store,
				env: {},
				has_ui: true,
				select: async () => 'Use global PATH binary instead',
			}),
		).resolves.toMatchObject({
			action: 'fallback',
			fallback: 'global',
			reason: 'user',
		});

		await expect(
			resolve_project_trust(lsp, {
				trust_store_path: store,
				env: {},
				has_ui: true,
				select: async () => 'Trust this binary path',
			}),
		).resolves.toMatchObject({
			action: 'trust-persisted',
			reason: 'user',
		});
		expect(is_project_subject_trusted(lsp, store)).toBe(true);
	});
});
