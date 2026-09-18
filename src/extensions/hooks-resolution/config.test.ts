import { describe, expect, it } from 'vite-plus/test';
import {
	compile_matcher,
	parse_claude_settings_hooks,
	resolve_hook_command,
} from './config.js';

describe('src/extensions/hooks-resolution/config.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./config.js')).resolves.toBeDefined();
	});

	it('resolves project-dir placeholders in hook commands', () => {
		expect(
			resolve_hook_command('echo $CLAUDE_PROJECT_DIR', '/repo'),
		).toBe('echo /repo');
	});

	it('ignores invalid matcher regexes', () => {
		expect(compile_matcher('[')).toBeUndefined();
	});

	it('parses Claude settings command hooks', () => {
		const hooks = parse_claude_settings_hooks(
			{
				hooks: {
					PreToolUse: [
						{
							matcher: 'bash',
							hooks: [{ type: 'command', command: 'echo ok' }],
						},
					],
				},
			},
			'/repo/.claude/settings.json',
			'/repo',
		);

		expect(hooks).toHaveLength(1);
		expect(hooks[0]).toMatchObject({
			event_name: 'PreToolUse',
			matcher_text: 'bash',
			command: 'echo ok',
		});
	});
});
