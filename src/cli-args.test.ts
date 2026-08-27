import { describe, expect, it } from 'vitest';
import {
	collect_flag_values,
	create_builtin_disable_cli_args,
	parse_extension_cli_args,
	parse_extension_paths,
	parse_skill_allowlist,
	parse_thinking_level,
	parse_tool_allowlist,
	parse_tool_excludelist,
	resolve_builtin_extension_options,
} from './cli-args.js';
import { BUILTIN_EXTENSIONS } from './extensions/builtin-registry.js';

describe('CLI arg helpers', () => {
	const known_args = {
		prompt: { type: 'string' as const, alias: 'p' },
		json: { type: 'boolean' as const, alias: 'j' },
		'agent-dir': { type: 'string' as const },
		extension: { type: 'string' as const, alias: 'e' },
	};

	it('separates extension string flags from positional prompts', () => {
		const spaced = parse_extension_cli_args(
			['--preset', 'asd-ste100', 'summarize this repo'],
			known_args,
		);
		const equals = parse_extension_cli_args(
			['--preset=asd-ste100', 'summarize this repo'],
			known_args,
		);

		expect(spaced.extension_flag_values.get('preset')).toBe(
			'asd-ste100',
		);
		expect(equals.extension_flag_values.get('preset')).toBe(
			'asd-ste100',
		);
		expect(spaced.positionals).toEqual(['summarize this repo']);
		expect(equals.positionals).toEqual(['summarize this repo']);
	});

	it('excludes wrapper flags and their values from extension candidates', () => {
		const parsed = parse_extension_cli_args(
			[
				'-e',
				'./probe.ts',
				'--preset',
				'asd-ste100',
				'--prompt',
				'actual prompt',
				'positional fallback',
			],
			known_args,
		);

		expect([...parsed.extension_flag_values]).toEqual([
			['preset', 'asd-ste100'],
		]);
		expect(parsed.positionals).toEqual(['positional fallback']);
	});

	it('recognizes Citty camel-case and negated wrapper flags', () => {
		const parsed = parse_extension_cli_args(
			['--agentDir', '/tmp/agent', '--no-json', 'prompt'],
			known_args,
		);

		expect(parsed.extension_flag_values.size).toBe(0);
		expect(parsed.positionals).toEqual(['prompt']);
	});

	it('preserves boolean extension flags before wrapper flags', () => {
		const parsed = parse_extension_cli_args(
			['--plan', '--prompt', 'actual prompt'],
			known_args,
		);

		expect(parsed.extension_flag_values.get('plan')).toBe(true);
		expect(parsed.positionals).toEqual([]);
	});

	it('reports unknown short flags and respects the option terminator', () => {
		const parsed = parse_extension_cli_args(
			['-z', '--', '--literal', 'prompt'],
			known_args,
		);

		expect(parsed.diagnostics).toEqual(['Unknown option: -z']);
		expect(parsed.positionals).toEqual(['--literal', 'prompt']);
	});

	it('collects repeated flags in spaced and equals forms', () => {
		expect(
			collect_flag_values(
				[
					'node',
					'dist/index.js',
					'--skill=ui',
					'--skill',
					'audit',
					'prompt text',
				],
				['--skill'],
			),
		).toEqual(['ui', 'audit']);
	});

	it('parses extension paths from short and long flags', () => {
		expect(
			parse_extension_paths(
				['my-pi', '-e', './a.ts', '--extension=../b.ts'],
				'/repo/app',
			),
		).toEqual(['/repo/app/a.ts', '/repo/b.ts']);
	});

	it('does not treat YAML-frontmatter prompt text passed via -p as extension flags', () => {
		expect(
			parse_extension_paths(
				[
					'my-pi',
					'-p',
					'---\ntitle: regression\n---\nSummarize this file.',
				],
				'/repo/app',
			),
		).toEqual([]);
	});

	it('parses and dedupes comma-separated tool allowlists across repeated flags', () => {
		expect(
			parse_tool_allowlist([
				'my-pi',
				'--tools=bash,read',
				'-t',
				'read,edit',
			]),
		).toEqual(['bash', 'read', 'edit']);
	});

	it('parses and dedupes comma-separated tool excludelists across repeated flags', () => {
		expect(
			parse_tool_excludelist([
				'my-pi',
				'--exclude-tools=bash,read',
				'-xt',
				'read,edit',
			]),
		).toEqual(['bash', 'read', 'edit']);
	});

	it('parses repeated and comma-separated skill allowlists', () => {
		expect(
			parse_skill_allowlist([
				'my-pi',
				'--skill=ui,polish',
				'--skill',
				'ui',
			]),
		).toEqual(['ui', 'polish']);
	});

	it('normalizes and validates thinking levels', () => {
		expect(parse_thinking_level('High')).toBe('high');
		expect(parse_thinking_level(undefined)).toBeUndefined();
		expect(() => parse_thinking_level('maximum')).toThrow(
			'--thinking must be one of',
		);
	});

	it('generates built-in disable CLI args from the registry', () => {
		const args = create_builtin_disable_cli_args();
		for (const extension of BUILTIN_EXTENSIONS) {
			expect(args[extension.cli_arg]).toMatchObject({
				type: 'boolean',
				description: extension.cli_description,
				default: false,
			});
		}
	});

	it('maps built-in defaults and disable flags to API options from the registry', () => {
		expect(resolve_builtin_extension_options({})).toMatchObject({
			factory: false,
			harness: true,
			mcp: true,
		});
		expect(
			resolve_builtin_extension_options({
				'no-mcp': true,
				'no-session-name': true,
			}),
		).toMatchObject({
			factory: false,
			mcp: false,
			session_name: false,
			recall: true,
		});

		expect(
			resolve_builtin_extension_options({ 'no-builtin': true }),
		).toMatchObject({
			mcp: false,
			skills: false,
			session_name: false,
		});
	});

	it('handles citty normalized negative boolean flags', () => {
		expect(
			resolve_builtin_extension_options({
				mcp: false,
				sessionName: false,
			}),
		).toMatchObject({
			mcp: false,
			session_name: false,
			recall: true,
		});

		expect(
			resolve_builtin_extension_options({ builtin: false }),
		).toMatchObject({
			mcp: false,
			skills: false,
			session_name: false,
		});
	});
});
