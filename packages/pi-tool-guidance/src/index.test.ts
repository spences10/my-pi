import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vite-plus/test';
import guidance, { tool_guidance } from './index.js';

type Tool = Parameters<typeof tool_guidance>[1][number];
const mcp = (
	server: string,
	exposure: Tool['exposure'] = 'codemode',
): Tool => ({
	name: `mcp__${server}__query`,
	exposure,
	namespace: { name: `mcp__${server}` },
});

describe('tool guidance', () => {
	it('always supplies essential secret guidance when a shell is available, even without local skills', () => {
		const text = tool_guidance(
			{ cwd: '/fresh-user', selectedTools: ['bash'] },
			[],
		);
		expect(text).toContain('Never read secret files');
		expect(text).toContain('separate Pi shells');
		expect(text).not.toContain('scott');
		expect(text).not.toContain('Omnisearch');
		expect(
			tool_guidance({ cwd: '/', selectedTools: ['read'] }, []),
		).toBe('');
	});

	it.each(['codemode', 'tool_search'])(
		'detects indirect MCP tools without requiring direct declarations: %s',
		(route) => {
			const text = tool_guidance(
				{ cwd: '/', selectedTools: [route] },
				[mcp('mcp-omnisearch'), mcp('mcp_sqlite_tools', 'deferred')],
			);
			expect(text).toContain('Omnisearch');
			expect(text).toContain('SQLite');
			expect(text).toContain('backup');
		},
	);

	it('detects configured indirect servers before they connect', () => {
		const text = tool_guidance(
			{
				cwd: '/',
				selectedTools: ['codemode'],
				sections: {
					mcp_servers:
						'- mcp__mcp_omnisearch (codemode)\n- mcp__mcp_sqlite_tools (codemode)',
				},
			},
			[],
		);
		expect(text).toContain('Omnisearch');
		expect(text).toContain('SQLite');
	});

	it('does not recommend unreachable, hidden, or absent integrations', () => {
		expect(
			tool_guidance({ cwd: '/', selectedTools: ['read'] }, [
				mcp('omnisearch'),
				mcp('sqlite'),
			]),
		).toBe('');
		expect(
			tool_guidance({ cwd: '/', selectedTools: ['codemode'] }, [
				mcp('omnisearch', 'hidden'),
				mcp('sqlite', 'direct'),
			]),
		).toBe('');
	});

	it('supports directly selected tools and hidden declarations in codemode-only mode', () => {
		const tool = mcp('omnisearch', 'direct');
		expect(
			tool_guidance({ cwd: '/', selectedTools: [tool.name] }, [tool]),
		).toContain('Omnisearch');
		expect(
			tool_guidance(
				{
					cwd: '/',
					selectedTools: ['bash', 'codemode'],
					hiddenTools: ['bash'],
				},
				[],
			),
		).toContain('Secret-safe');
	});

	it('mutates only its named section, preserves custom prompts, and clears stale guidance', () => {
		let handler!: Function;
		guidance({
			on: (_name: string, fn: Function) => {
				handler = fn;
			},
			getAllTools: () => [],
		} as unknown as ExtensionAPI);
		const event = {
			systemPrompt: 'USER SYSTEM AND APPEND',
			systemPromptOptions: {
				cwd: '/',
				customPrompt: 'USER SYSTEM',
				appendSystemPrompt: 'USER APPEND',
				selectedTools: ['bash'],
				sections: { unrelated: 'keep' } as Record<string, string>,
			},
		};
		expect(handler(event)).toBeUndefined();
		expect(
			event.systemPromptOptions.sections.my_pi_tool_guidance,
		).toContain('Secret-safe');
		expect(event.systemPromptOptions.customPrompt).toBe(
			'USER SYSTEM',
		);
		expect(event.systemPromptOptions.appendSystemPrompt).toBe(
			'USER APPEND',
		);
		event.systemPromptOptions.sections.later_extension =
			'still visible';
		event.systemPromptOptions.selectedTools = ['read'];
		handler(event);
		expect(event.systemPromptOptions.sections).toEqual({
			unrelated: 'keep',
			later_extension: 'still visible',
		});
		expect(event.systemPrompt).toBe('USER SYSTEM AND APPEND');
	});

	it('ships portable native skills in the package rather than relying on a user directory', () => {
		const manifest = JSON.parse(
			readFileSync(
				new URL('../package.json', import.meta.url),
				'utf8',
			),
		);
		expect(manifest.files).toContain('skills');
		expect(manifest.pi.skills).toEqual(['./skills']);
		for (const name of ['nopeek', 'omnisearch', 'sqlite']) {
			const skill = readFileSync(
				new URL(`../skills/my-pi-${name}/SKILL.md`, import.meta.url),
				'utf8',
			);
			expect(skill).toContain(`name: my-pi-${name}`);
			expect(skill).toContain('description: Use when');
			expect(skill).not.toContain('/home/scott');
		}
	});
});
