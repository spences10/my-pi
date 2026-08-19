import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from '@earendil-works/pi-coding-agent';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import type { PromptPresetManagerResult } from './manager.js';
import type { LoadedPromptPreset } from './types.js';

const manager = vi.hoisted(() => ({
	results: [] as PromptPresetManagerResult[],
}));
vi.mock('./manager.js', () => ({
	show_prompt_preset_manager: vi.fn(
		async () => manager.results.shift() ?? { action: 'cancel' },
	),
}));

import prompt_presets, {
	load_persisted_prompt_state,
} from './index.js';
import { save_project_prompt_preset_file } from './storage.js';

const roots: string[] = [];
const original_agent_dir = process.env.PI_CODING_AGENT_DIR;

function loaded(name: string, editable = true): LoadedPromptPreset {
	return {
		name,
		kind: 'layer',
		instructions: `${name} instructions`,
		source: editable ? 'project' : 'builtin',
		origin: editable ? 'project-markdown' : 'builtin',
		path: editable ? `/tmp/${name}.md` : null,
		editable,
		fallbacks: [],
	};
}

async function setup(options?: {
	input?: string[];
	editor?: string;
}) {
	const root = mkdtempSync(join(tmpdir(), 'prompt-manager-'));
	roots.push(root);
	const cwd = join(root, 'project');
	process.env.PI_CODING_AGENT_DIR = join(root, 'agent');
	const handlers = new Map<
		string,
		(...args: unknown[]) => Promise<unknown>
	>();
	let command:
		| {
				handler: (
					args: string,
					ctx: ExtensionCommandContext,
				) => Promise<void>;
		  }
		| undefined;
	const append_entry = vi.fn();
	const pi = {
		appendEntry: append_entry,
		getFlag: vi.fn(),
		on: vi.fn(
			(
				event: string,
				handler: (...args: unknown[]) => Promise<unknown>,
			) => handlers.set(event, handler),
		),
		registerCommand: vi.fn(
			(name: string, definition: typeof command) => {
				if (name === 'prompt-preset') command = definition;
			},
		),
		registerFlag: vi.fn(),
	} as unknown as ExtensionAPI;
	const inputs = [...(options?.input ?? [])];
	const ui = {
		confirm: vi.fn(async () => true),
		editor: vi.fn(
			async () => options?.editor ?? '---\nkind: layer\n---\nedited',
		),
		input: vi.fn(async () => inputs.shift() ?? null),
		notify: vi.fn(),
		select: vi.fn(async () => 'Project (.pi/presets)'),
		setStatus: vi.fn(),
	};
	const ctx = {
		cwd,
		hasUI: true,
		mode: 'tui',
		sessionManager: { getEntries: () => [] },
		ui,
	} as unknown as ExtensionCommandContext;
	await prompt_presets(pi);
	await handlers.get('session_start')?.({}, ctx);
	return { command: command!, ctx, ui, append_entry, cwd };
}

beforeEach(() => {
	manager.results = [];
});
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
	if (original_agent_dir === undefined)
		delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = original_agent_dir;
});

describe('prompt preset TUI management flows', () => {
	it('creates with explicit scope and reopens the catalog', async () => {
		manager.results.push({ action: 'create' }, { action: 'cancel' });
		const { command, ctx, ui, cwd } = await setup({
			input: ['new-layer'],
		});
		await command.handler('', ctx);
		expect(ui.select).toHaveBeenCalled();
		expect(existsSync(join(cwd, '.pi/presets/new-layer.md'))).toBe(
			true,
		);
		expect(manager.results).toEqual([]);
	});

	it('edits a custom preset and blocks editing a built-in', async () => {
		manager.results.push(
			{ action: 'edit', preset: loaded('custom') },
			{ action: 'cancel' },
		);
		const first = await setup();
		save_project_prompt_preset_file(first.cwd, 'custom', {
			kind: 'layer',
			instructions: 'old',
		});
		await first.command.handler('', first.ctx);
		expect(first.ui.editor).toHaveBeenCalled();

		manager.results.push(
			{ action: 'edit', preset: loaded('terse', false) },
			{ action: 'cancel' },
		);
		const second = await setup();
		await second.command.handler('', second.ctx);
		expect(second.ui.editor).not.toHaveBeenCalled();
		expect(second.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining('read-only'),
			'warning',
		);
	});

	it.each(['copy', 'rename'] as const)(
		'%s writes only after scope choice',
		async (action) => {
			manager.results.push(
				{
					action,
					preset: loaded(
						action === 'copy' ? 'terse' : 'custom',
						action !== 'copy',
					),
				},
				{ action: 'cancel' },
			);
			const target = `${action}-target`;
			const run = await setup({ input: [target] });
			if (action === 'rename')
				save_project_prompt_preset_file(run.cwd, 'custom', {
					kind: 'layer',
					instructions: 'old',
				});
			await run.command.handler('', run.ctx);
			expect(run.ui.select).toHaveBeenCalled();
			expect(
				existsSync(join(run.cwd, `.pi/presets/${target}.md`)),
			).toBe(true);
		},
	);

	it.each(['delete', 'reset'] as const)(
		'%s confirms, refreshes, and persists normalized active state',
		async (action) => {
			manager.results.push(
				{ action, preset: loaded('custom') },
				{ action: 'cancel' },
			);
			const run = await setup();
			save_project_prompt_preset_file(run.cwd, 'custom', {
				kind: 'layer',
				instructions: 'old',
			});
			await run.command.handler('enable custom', run.ctx);
			await run.command.handler('', run.ctx);
			expect(run.ui.confirm).toHaveBeenCalled();
			expect(run.append_entry).toHaveBeenLastCalledWith(
				'prompt-preset-state',
				{ base_name: 'terse', layer_names: [] },
			);
			expect(load_persisted_prompt_state(run.cwd)).toEqual({
				base_name: 'terse',
				layer_names: [],
			});
		},
	);

	it('reload reopens and surfaces validation diagnostics', async () => {
		manager.results.push({ action: 'reload' }, { action: 'cancel' });
		const run = await setup();
		const dir = join(run.cwd, '.pi/presets');
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, 'broken.md'),
			'---\nkind: invalid\n---\ntext',
		);
		await run.command.handler('', run.ctx);
		expect(run.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining('validation issue'),
			'warning',
		);
		expect(manager.results).toEqual([]);
	});

	it('does not open the TUI manager outside TUI mode', async () => {
		manager.results.push({ action: 'create' });
		const run = await setup();
		(run.ctx as unknown as { mode: string }).mode = 'rpc';
		await run.command.handler('', run.ctx);
		expect(manager.results).toHaveLength(1);
		expect(run.ui.notify).toHaveBeenCalled();
	});
});
