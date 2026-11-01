import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { HARNESS_ASSESSMENT_CUSTOM_TYPE } from './assessment.js';
import harness from './extension.js';
import { HARNESS_CUSTOM_TYPE } from './schema.js';

const cleanup: string[] = [];
afterEach(() => {
	for (const dir of cleanup.splice(0).reverse())
		rmSync(dir, { recursive: true, force: true });
});
function fixture() {
	const cwd = mkdtempSync(join(tmpdir(), 'pi-harness-extension-'));
	cleanup.push(cwd);
	execFileSync('git', ['-C', cwd, 'init'], { stdio: 'ignore' });
	const commands = new Map<string, { handler: Function }>();
	const tools = new Map<string, { execute: Function }>();
	const handlers = new Map<string, Function>();
	const appendEntry = vi.fn();
	const setActiveTools = vi.fn();
	const sendUserMessage = vi.fn();
	let branch: unknown[] = [];
	const api = {
		appendEntry,
		setActiveTools,
		getActiveTools: () => [
			'read',
			'bash',
			'edit',
			'codemode',
			'tool_search',
		],
		registerCommand: (
			name: string,
			definition: { handler: Function },
		) => commands.set(name, definition),
		registerTool: (definition: { name: string; execute: Function }) =>
			tools.set(definition.name, definition),
		on: (name: string, handler: Function) =>
			handlers.set(name, handler),
		sendUserMessage,
	} as unknown as ExtensionAPI;
	const ctx = {
		cwd,
		hasUI: true,
		sessionManager: {
			getBranch: () => branch,
			getEntries: () => [
				{
					type: 'custom',
					customType: HARNESS_CUSTOM_TYPE,
					data: { active_harness_dir: '/wrong-branch' },
				},
			],
		},
		ui: { notify: vi.fn(), setStatus: vi.fn(), setWidget: vi.fn() },
		executeTool: vi.fn(
			async (_name: string, args: { command: string }) => {
				const result = spawnSync('bash', ['-lc', args.command], {
					cwd,
					encoding: 'utf8',
				});
				return {
					isError: result.status !== 0,
					result: {
						content: [
							{ type: 'text', text: result.stdout + result.stderr },
						],
						details: {},
					},
				};
			},
		),
	};
	return {
		api,
		ctx,
		commands,
		tools,
		handlers,
		appendEntry,
		setActiveTools,
		sendUserMessage,
		setBranch: (entries: unknown[]) => {
			branch = entries;
		},
	};
}
async function create(
	f: ReturnType<typeof fixture>,
	checks = ['true'],
	allowed_paths?: string[],
) {
	await f.tools.get('harness_create')!.execute(
		'create',
		{
			task: 'Bounded task',
			validation_commands: checks,
			allowed_paths,
		},
		undefined,
		undefined,
		f.ctx,
	);
	const entry = f.appendEntry.mock.calls.find(
		([kind]) => kind === HARNESS_CUSTOM_TYPE,
	);
	const dir = entry![1].active_harness_dir as string;
	cleanup.push(dir);
	return dir;
}

describe('harness extension', () => {
	it('creates directly without assessment or another approval roundtrip', async () => {
		const f = fixture();
		harness(f.api);
		expect(
			await f.handlers.get('tool_call')!(
				{ toolName: 'harness_create', input: { task: 'Task' } },
				f.ctx,
			),
		).toBeUndefined();
		const dir = await create(f);
		expect(readFileSync(join(dir, 'harness.json'), 'utf8')).toContain(
			'Bounded task',
		);
		expect(
			f.appendEntry.mock.calls.some(
				([kind]) => kind === HARNESS_ASSESSMENT_CUSTOM_TYPE,
			),
		).toBe(false);
		expect(f.setActiveTools).not.toHaveBeenCalled();
	});
	it('preserves native discovery and harmless research commands during optional assessment', async () => {
		const f = fixture();
		harness(f.api);
		await f.tools
			.get('harness_assess')!
			.execute(
				'assess',
				{ task: 'Investigate' },
				undefined,
				undefined,
				f.ctx,
			);
		for (const event of [
			{ toolName: 'codemode', input: {} },
			{ toolName: 'tool_search', input: {} },
			{ toolName: 'mcp__mcp_omnisearch__web_search', input: {} },
			{
				toolName: 'bash',
				input: { command: 'rg needle src | head -20' },
			},
			{
				toolName: 'bash',
				input: { command: "sed -n 'w /tmp/probe' input" },
			},
		])
			expect(
				await f.handlers.get('tool_call')!(event, f.ctx),
			).toBeUndefined();
		expect(f.setActiveTools).not.toHaveBeenCalled();
		expect(f.handlers.has('agent_end')).toBe(false);
		await create(f);
	});
	it('uses creation command to scaffold instead of starting another assessment', async () => {
		const f = fixture();
		harness(f.api);
		await f.commands
			.get('harness')!
			.handler('create Add feature tests', f.ctx);
		expect(f.sendUserMessage).toHaveBeenCalledWith(
			expect.stringContaining('No assessment or extra approval'),
		);
		expect(f.setActiveTools).not.toHaveBeenCalled();
	});
	it('runs completion through nested bash hooks and stores actual checks', async () => {
		const f = fixture();
		harness(f.api);
		const dir = await create(f);
		await f.tools
			.get('harness_update')!
			.execute(
				'complete',
				{ harness_dir: dir, status: 'completed' },
				undefined,
				undefined,
				f.ctx,
			);
		expect(f.ctx.executeTool).toHaveBeenCalledTimes(2);
		const outcome = JSON.parse(
			readFileSync(join(dir, 'outcome.json'), 'utf8'),
		);
		expect(outcome.status).toBe('completed');
		expect(outcome.validation.checks).toHaveLength(2);
		expect(
			outcome.validation.checks.every(
				(check: { passed: boolean }) => check.passed,
			),
		).toBe(true);
	});
	it('does not accept a forged success note when a nested check fails', async () => {
		const f = fixture();
		harness(f.api);
		const dir = await create(f, ['false']);
		await expect(
			f.tools.get('harness_update')!.execute(
				'complete',
				{
					harness_dir: dir,
					status: 'completed',
					evidence: 'All checks passed',
				},
				undefined,
				undefined,
				f.ctx,
			),
		).rejects.toThrow('not completed');
		expect(
			JSON.parse(readFileSync(join(dir, 'status.json'), 'utf8'))
				.status,
		).toBe('failed');
	});
	it('keeps permission-denied nested tools as failed validation', async () => {
		const f = fixture();
		harness(f.api);
		const dir = await create(f);
		f.ctx.executeTool.mockResolvedValueOnce({
			isError: true,
			result: {
				content: [{ type: 'text', text: 'Permission denied' }],
				details: {},
			},
		});
		await expect(
			f.tools
				.get('harness_update')!
				.execute(
					'complete',
					{ harness_dir: dir, status: 'completed' },
					undefined,
					undefined,
					f.ctx,
				),
		).rejects.toThrow('not completed');
		expect(f.ctx.executeTool).toHaveBeenCalledTimes(1);
		expect(
			JSON.parse(
				readFileSync(join(dir, 'status.json'), 'utf8'),
			).log.at(-1).checks[0].passed,
		).toBe(false);
	});

	it('uses execution-worktree paths and rejects unrelated repositories', async () => {
		const f = fixture();
		harness(f.api);
		execFileSync(
			'git',
			[
				'-C',
				f.ctx.cwd,
				'-c',
				'user.email=test@example.com',
				'-c',
				'user.name=Test',
				'-c',
				'commit.gpgsign=false',
				'-c',
				'core.hooksPath=/dev/null',
				'commit',
				'--allow-empty',
				'-m',
				'initial',
			],
			{ stdio: 'ignore' },
		);
		await create(f, ['true'], [join(f.ctx.cwd, 'src/**')]);
		const worktree = mkdtempSync(
			join(tmpdir(), 'pi-harness-hook-worktree-'),
		);
		cleanup.push(worktree);
		execFileSync(
			'git',
			[
				'-C',
				f.ctx.cwd,
				'worktree',
				'add',
				'-b',
				'executor',
				worktree,
			],
			{ stdio: 'ignore' },
		);
		f.ctx.cwd = worktree;
		expect(
			await f.handlers.get('tool_call')!(
				{ toolName: 'edit', input: { path: 'src/new.test.ts' } },
				f.ctx,
			),
		).toBeUndefined();
		f.ctx.cwd = fixture().ctx.cwd;
		expect(
			await f.handlers.get('tool_call')!(
				{ toolName: 'edit', input: { path: 'src/new.ts' } },
				f.ctx,
			),
		).toMatchObject({ block: true });
	});

	it('rejects control calls for another harness and unknown mutation paths', async () => {
		const f = fixture();
		harness(f.api);
		await create(f);
		await expect(
			f.tools
				.get('harness_amend')!
				.execute(
					'amend',
					{ harness_dir: '/another', reason: 'Escape' },
					undefined,
					undefined,
					f.ctx,
				),
		).rejects.toThrow('select this harness');
		expect(
			await f.handlers.get('tool_call')!(
				{ toolName: 'edit', input: {} },
				f.ctx,
			),
		).toMatchObject({ block: true });
	});
	it('restores only the active branch and remains usable without a UI', async () => {
		const f = fixture();
		harness(f.api);
		const dir = await create(f, ['true'], ['src/**']);
		f.setBranch([
			{
				type: 'custom',
				customType: HARNESS_CUSTOM_TYPE,
				data: { active_harness_dir: dir },
			},
		]);
		await f.handlers.get('session_start')!({}, f.ctx);
		expect(
			await f.handlers.get('tool_call')!(
				{ toolName: 'edit', input: { path: 'src/allowed.ts' } },
				f.ctx,
			),
		).toBeUndefined();
		expect(
			await f.handlers.get('tool_call')!(
				{ toolName: 'edit', input: { path: 'README.md' } },
				f.ctx,
			),
		).toMatchObject({ block: true });
		f.setBranch([]);
		await f.handlers.get('session_tree')!({}, f.ctx);
		f.ctx.hasUI = false;
		await f.tools
			.get('harness_assess')!
			.execute(
				'assess',
				{ task: 'Headless planning' },
				undefined,
				undefined,
				f.ctx,
			);
		expect(f.setActiveTools).not.toHaveBeenCalled();
	});
});
