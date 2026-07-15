import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { write_package_settings } from '@spences10/pi-settings';
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	is_path_allowed,
	load_svelte_guardrails_config,
} from './config.js';
import svelte_guardrails, {
	assess_svelte_effect,
	contains_disallowed_effect,
	extract_bash_svelte_path,
	is_svelte_path,
	should_block_svelte_effect,
} from './index.js';

const original_config_path =
	process.env.MY_PI_SVELTE_GUARDRAILS_CONFIG;
const original_agent_dir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
	if (original_config_path === undefined) {
		delete process.env.MY_PI_SVELTE_GUARDRAILS_CONFIG;
	} else {
		process.env.MY_PI_SVELTE_GUARDRAILS_CONFIG = original_config_path;
	}
	if (original_agent_dir === undefined) {
		delete process.env.PI_CODING_AGENT_DIR;
	} else {
		process.env.PI_CODING_AGENT_DIR = original_agent_dir;
	}
});

describe('svelte guardrails', () => {
	it('detects Svelte file paths and $effect usage', () => {
		expect(is_svelte_path('src/App.svelte')).toBe(true);
		expect(is_svelte_path('src/App.ts')).toBe(false);
		expect(contains_disallowed_effect('$effect(() => {})')).toBe(
			true,
		);
		expect(contains_disallowed_effect('$derived(value)')).toBe(false);
	});

	it('blocks write/edit calls that introduce $effect in Svelte files', () => {
		expect(
			should_block_svelte_effect({
				type: 'tool_call',
				toolName: 'write',
				toolCallId: '1',
				input: {
					path: 'src/App.svelte',
					content: '<script>$effect(() => {})</script>',
				},
			} satisfies Parameters<typeof should_block_svelte_effect>[0]),
		).toContain('was not created or modified');

		expect(
			should_block_svelte_effect({
				type: 'tool_call',
				toolName: 'write',
				toolCallId: '2',
				input: {
					path: 'src/App.svelte',
					content: '<script>const value = $derived(count)</script>',
				},
			} satisfies Parameters<typeof should_block_svelte_effect>[0]),
		).toBeUndefined();
	});

	it('blocks bash heredocs that create Svelte files with $effect', () => {
		const command = `cat > ExampleEffect.svelte <<'EOF'
<script>$effect(() => {})</script>
EOF`;

		expect(extract_bash_svelte_path(command)).toBe(
			'ExampleEffect.svelte',
		);
		expect(
			should_block_svelte_effect({
				type: 'tool_call',
				toolName: 'bash',
				toolCallId: '3',
				input: { command },
			} satisfies Parameters<typeof should_block_svelte_effect>[0]),
		).toContain('was not created or modified');
	});

	it('allows configured paths', () => {
		expect(
			is_path_allowed('examples/App.svelte', ['examples/**']),
		).toBe(true);
		expect(is_path_allowed('src/App.svelte', ['examples/**'])).toBe(
			false,
		);
		expect(
			should_block_svelte_effect(
				{
					type: 'tool_call',
					toolName: 'write',
					toolCallId: '4',
					input: {
						path: 'examples/App.svelte',
						content: '<script>$effect(() => {})</script>',
					},
				} satisfies Parameters<typeof should_block_svelte_effect>[0],
				{
					version: 1,
					blockEffect: true,
					allow: ['examples/**'],
					mode: 'block',
				},
			),
		).toBeUndefined();
	});

	it('can disable the $effect rule from config', () => {
		expect(
			should_block_svelte_effect(
				{
					type: 'tool_call',
					toolName: 'write',
					toolCallId: '5',
					input: {
						path: 'src/App.svelte',
						content: '<script>$effect(() => {})</script>',
					},
				} satisfies Parameters<typeof should_block_svelte_effect>[0],
				{ version: 1, blockEffect: false, allow: [], mode: 'block' },
			),
		).toBeUndefined();
	});

	it('supports block, warn, and off modes', () => {
		const event = {
			type: 'tool_call',
			toolName: 'write',
			toolCallId: '6',
			input: {
				path: 'src/App.svelte',
				content: '<script>$effect(() => {})</script>',
			},
		} satisfies Parameters<typeof assess_svelte_effect>[0];

		expect(
			assess_svelte_effect(event, {
				version: 1,
				blockEffect: true,
				allow: [],
				mode: 'block',
			})?.mode,
		).toBe('block');
		expect(
			assess_svelte_effect(event, {
				version: 1,
				blockEffect: true,
				allow: [],
				mode: 'warn',
			})?.mode,
		).toBe('warn');
		expect(
			assess_svelte_effect(event, {
				version: 1,
				blockEffect: true,
				allow: [],
				mode: 'off',
			}),
		).toBeUndefined();
	});

	it('warns without blocking in warn mode', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'svelte-guardrails-'));
		process.env.PI_CODING_AGENT_DIR = dir;
		write_package_settings('svelteGuardrails', { mode: 'warn' });

		const events = new Map<string, Function>();
		svelte_guardrails({
			on: (name: string, handler: Function) =>
				events.set(name, handler),
		} as unknown as ExtensionAPI);

		const notifications: string[] = [];
		const result = await events.get('tool_call')?.(
			{
				type: 'tool_call',
				toolName: 'write',
				toolCallId: '7',
				input: {
					path: 'src/App.svelte',
					content: '<script>$effect(() => {})</script>',
				},
			} satisfies Parameters<typeof should_block_svelte_effect>[0],
			{
				ui: {
					notify: (message: string) => notifications.push(message),
				},
			} as unknown as ExtensionContext,
		);

		expect(result).toBeUndefined();
		expect(notifications[0]).toContain(
			'Blocked by Svelte guardrails',
		);
		rmSync(dir, { recursive: true, force: true });
	});

	it('loads global config with project-local overrides', () => {
		const dir = mkdtempSync(join(tmpdir(), 'svelte-guardrails-'));
		const project = join(dir, 'project');
		const project_config = join(
			project,
			'.pi',
			'svelte-guardrails.json',
		);
		mkdirSync(join(project, '.pi'), { recursive: true });
		process.env.PI_CODING_AGENT_DIR = dir;
		write_package_settings('svelteGuardrails', {
			blockEffect: false,
			allow: ['legacy/**'],
		});
		writeFileSync(project_config, JSON.stringify({ mode: 'warn' }));

		expect(load_svelte_guardrails_config(project)).toEqual({
			version: 1,
			blockEffect: false,
			allow: ['legacy/**'],
			mode: 'warn',
		});
		rmSync(dir, { recursive: true, force: true });
	});
});
