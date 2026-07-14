import { CONFIG_DIR_NAME } from '@earendil-works/pi-coding-agent';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	activate_policy_draft,
	discover_repository_policy,
	discover_with_existing_policy,
	factory_policy_path,
	reject_policy_draft,
	validate_policy_draft,
} from './policy-authoring.js';
import type { RepositoryPolicy } from './types.js';

function fixture(
	manager: 'pnpm' | 'npm' | 'yarn' | 'bun' = 'pnpm',
): string {
	const root = mkdtempSync(join(tmpdir(), 'factory-policy-'));
	const lockfile = {
		pnpm: 'pnpm-lock.yaml',
		npm: 'package-lock.json',
		yarn: 'yarn.lock',
		bun: 'bun.lock',
	}[manager];
	writeFileSync(join(root, lockfile), '');
	return root;
}
function put(root: string, path: string, content: string): void {
	const target = join(root, path);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, content);
}

describe('repository policy authoring', () => {
	it('discovers monorepo validations, risky paths, ownership, and release boundaries with provenance', () => {
		const root = fixture();
		put(
			root,
			'package.json',
			JSON.stringify({
				workspaces: ['packages/*'],
				scripts: {
					test: 'vitest',
					check: 'tsc',
					deploy: 'unsafe-command-that-must-not-run',
					publish: 'another-command-that-must-not-run',
				},
			}),
		);
		put(
			root,
			'packages/app/prisma/schema.prisma',
			'datasource db {}',
		);
		put(root, '.github/CODEOWNERS', '* @owner');
		put(root, 'AGENTS.md', 'Never deploy automatically.');
		const draft = discover_repository_policy(root);

		expect(
			draft.policy.validations?.map((gate) => gate.command),
		).toEqual(['pnpm test', 'pnpm check']);
		expect(draft.policy.risky_paths).toContain(
			'packages/app/prisma/**',
		);
		expect(draft.policy.required_approvals).toEqual([
			'deploy',
			'release',
		]);
		expect(draft.evidence.map((item) => item.kind)).toEqual(
			expect.arrayContaining([
				'workspace',
				'package-script',
				'database',
				'ownership',
				'agent-instruction',
			]),
		);
		expect(
			draft.inferences.every((item) => item.evidence_ids.length > 0),
		).toBe(true);
		expect(
			draft.questions.some((item) => item.field === 'ownership'),
		).toBe(true);
		expect(existsSync(factory_policy_path(root))).toBe(false);
	});

	it('treats project content as data and turns conflicting CI into a question', () => {
		const root = fixture();
		put(
			root,
			'package.json',
			JSON.stringify({ scripts: { test: 'touch SHOULD_NOT_EXIST' } }),
		);
		put(
			root,
			'.github/workflows/ci.yml',
			'jobs:\n  check:\n    steps:\n      - run: pnpm lint\n',
		);
		const draft = discover_repository_policy(root);
		expect(existsSync(join(root, 'SHOULD_NOT_EXIST'))).toBe(false);
		expect(
			draft.questions.some((item) =>
				item.message.includes('different validation commands'),
			),
		).toBe(true);
		expect(
			draft.policy.validations?.map((gate) => gate.command),
		).toEqual(['pnpm test', 'pnpm lint']);
	});

	it.each([
		['pnpm', 'pnpm test'],
		['npm', 'npm run test'],
		['yarn', 'yarn test'],
		['bun', 'bun run test'],
	] as const)(
		'uses the detected %s package manager',
		(manager, command) => {
			const root = fixture(manager);
			put(
				root,
				'package.json',
				JSON.stringify({ scripts: { test: 'runner' } }),
			);
			expect(
				discover_repository_policy(root).policy.validations?.[0]
					?.command,
			).toBe(command);
		},
	);

	it('discovers multiline and workspace CI commands and questions unsupported commands', () => {
		const root = fixture();
		put(
			root,
			'.github/workflows/ci.yml',
			'jobs:\n  test:\n    steps:\n      - run: |\n          pnpm --filter @scope/app test\n          npm --workspace web run check\n          yarn lint && echo unsafe\n',
		);
		const draft = discover_repository_policy(root);
		expect(
			draft.policy.validations?.map((gate) => gate.command),
		).toEqual([
			'pnpm --filter @scope/app test',
			'npm --workspace web run check',
		]);
		expect(draft.questions).toContainEqual(
			expect.objectContaining({
				message: expect.stringContaining('yarn lint &&'),
			}),
		);
	});

	it('handles missing configuration without guessing permissions', () => {
		const root = fixture();
		expect(factory_policy_path(root)).toBe(
			join(root, CONFIG_DIR_NAME, 'factory.json'),
		);
		const draft = discover_repository_policy(root);
		expect(draft.policy.required_approvals).toBeUndefined();
		expect(draft.policy.validations).toBeUndefined();
		expect(draft.activation.required).toBe(true);
	});

	it('preserves intentional policy and reports discovery drift', () => {
		const root = fixture();
		put(
			root,
			'package.json',
			JSON.stringify({ scripts: { test: 'vitest' } }),
		);
		const current: RepositoryPolicy = {
			schema_version: 1,
			policy_id: 'manual@2',
			validations: [
				{
					id: 'manual',
					execution: 'shell',
					command: 'pnpm test:unit',
					source: 'test',
					required: true,
				},
			],
			risky_paths: ['secrets/**'],
			required_approvals: ['public-contract'],
		};
		put(
			root,
			`${CONFIG_DIR_NAME}/factory.json`,
			JSON.stringify(current),
		);
		const draft = discover_with_existing_policy(root);
		expect(draft.policy.policy_id).toBe(current.policy_id);
		expect(draft.policy.validations).toEqual([
			current.validations![0],
			expect.objectContaining({ command: 'pnpm test' }),
		]);
		expect(draft.policy.risky_paths).toEqual(['secrets/**']);
		expect(draft.policy.required_approvals).toEqual([
			'public-contract',
		]);
		expect(draft.evidence).toContainEqual(
			expect.objectContaining({ kind: 'existing-policy' }),
		);
		expect(draft.inferences).toContainEqual(
			expect.objectContaining({
				field: 'policy_id',
				value: 'manual@2',
			}),
		);
		expect(draft.drift).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					field: 'validations',
					status: 'changed',
				}),
			]),
		);
	});

	it('validates edited drafts and requires explicit activation', () => {
		const root = fixture();
		const draft = discover_repository_policy(root);
		draft.policy = {
			schema_version: 1,
			policy_id: 'reviewed@1',
			risky_paths: ['migrations/**'],
			required_approvals: ['deploy'],
		};
		validate_policy_draft(draft);
		expect(() =>
			activate_policy_draft(draft, {
				trusted_root: root,
				authorization: { kind: 'embedding-application', actor: ' ' },
			}),
		).toThrow('actor');
		const target = activate_policy_draft(draft, {
			trusted_root: root,
			authorization: {
				kind: 'embedding-application',
				actor: 'reviewer@example.com',
			},
		});
		expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual(
			draft.policy,
		);
	});

	it('rejects injected package paths and CI shell chains', () => {
		const root = fixture();
		put(
			root,
			'packages/unsafe;touch-PWNED/package.json',
			JSON.stringify({ scripts: { test: 'vitest' } }),
		);
		put(
			root,
			'.github/workflows/ci.yml',
			'jobs:\n  test:\n    steps:\n      - run: pnpm test && touch PWNED\n      - run: pnpm check\n',
		);
		const draft = discover_repository_policy(root);
		expect(
			draft.policy.validations?.map((gate) => gate.command),
		).toEqual(['pnpm check']);
		expect(
			draft.questions.filter((item) => item.field === 'validations'),
		).toHaveLength(2);
		expect(existsSync(join(root, 'PWNED'))).toBe(false);
	});

	it('binds activation to the trusted root and rejects stale drafts', () => {
		const root = fixture();
		const other = fixture();
		const draft = discover_repository_policy(root);
		draft.root = other;
		draft.activation.target = factory_policy_path(other);
		expect(() =>
			activate_policy_draft(draft, {
				trusted_root: root,
				authorization: {
					kind: 'embedding-application',
					actor: 'reviewer',
				},
			}),
		).toThrow('trusted repository root');

		const fresh = discover_repository_policy(root);
		put(
			root,
			`${CONFIG_DIR_NAME}/factory.json`,
			JSON.stringify({ schema_version: 1, policy_id: 'newer@1' }),
		);
		expect(() =>
			activate_policy_draft(fresh, {
				trusted_root: root,
				authorization: {
					kind: 'embedding-application',
					actor: 'reviewer',
				},
			}),
		).toThrow('changed after discovery');
	});

	it('rejects a symlinked policy directory that escapes the trusted root', () => {
		const root = fixture();
		const outside = fixture();
		symlinkSync(outside, join(root, CONFIG_DIR_NAME));
		const draft = discover_repository_policy(root);
		expect(() =>
			activate_policy_draft(draft, {
				trusted_root: root,
				authorization: {
					kind: 'embedding-application',
					actor: 'reviewer',
				},
			}),
		).toThrow('symbolic link');
		expect(existsSync(join(outside, 'factory.json'))).toBe(false);
	});

	it('records explicit rejection without writing policy', () => {
		const root = fixture();
		const draft = discover_repository_policy(root);
		expect(
			reject_policy_draft(draft, 'Validation evidence is incomplete'),
		).toEqual(
			expect.objectContaining({
				draft_id: draft.draft_id,
				decision: 'rejected',
			}),
		);
		expect(existsSync(factory_policy_path(root))).toBe(false);
		expect(() => reject_policy_draft(draft, ' ')).toThrow('reason');
	});

	it('rejects unsafe edited policy before activation', () => {
		const draft = discover_repository_policy(fixture());
		(
			draft.policy as unknown as Record<string, unknown>
		).unknown_permission = true;
		expect(() => validate_policy_draft(draft)).toThrow('unknown');
	});
});
