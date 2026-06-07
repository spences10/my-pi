#!/usr/bin/env node

// CLI for my-pi — composable pi coding agent

import { defineCommand, renderUsage, runMain } from 'citty';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	create_builtin_disable_cli_args,
	parse_extension_paths,
	parse_skill_allowlist,
	parse_thinking_level,
	parse_tool_allowlist,
	parse_tool_excludelist,
	resolve_builtin_extension_options,
} from './cli-args.js';
import { install_sqlite_warning_filter } from './warnings.js';

install_sqlite_warning_filter();

const __dirname = dirname(fileURLToPath(import.meta.url));
const package_root = join(__dirname, '..');
const pkg = JSON.parse(
	readFileSync(join(package_root, 'package.json'), 'utf-8'),
);

// my-pi is a wrapper around Pi; upstream Pi update banners are useful in
// this repo, but confusing for installed wrapper users.
if (!existsSync(join(package_root, '.git'))) {
	process.env.PI_SKIP_VERSION_CHECK ??= '1';
}

async function read_stdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks).toString('utf-8').trim();
}

async function run_interactive_mode(
	runtime: any,
	InteractiveModeClass: any,
): Promise<void> {
	const original_write = process.stdout.write.bind(process.stdout);
	process.stdout.write = ((chunk: any, ...args: any[]) => {
		if (typeof chunk === 'string') {
			const escape = String.fromCharCode(27);
			const styled_hint = new RegExp(
				`(To resume this session:${escape}\\[[\\d;]*m )pi( --session )`,
				'g',
			);
			chunk = chunk.replace(styled_hint, '$1my-pi$2');
			chunk = chunk.replace(
				/(To resume this session: )pi( --session )/g,
				'$1my-pi$2',
			);
		}
		return original_write(chunk, ...args);
	}) as typeof process.stdout.write;
	try {
		const mode = new InteractiveModeClass(runtime, {
			migratedProviders: [],
			modelFallbackMessage: undefined,
			initialMessage: undefined,
			initialImages: [],
			initialMessages: [],
		});
		await mode.run();
	} finally {
		process.stdout.write =
			original_write as typeof process.stdout.write;
	}
}

const HELP_APPENDIX = `
MODES

  my-pi
    Interactive TUI with slash commands, editor, and session UI.

  my-pi "prompt"
  my-pi -P "prompt"
    One-shot print mode with plain text output.

  my-pi --json "prompt"
    Non-interactive NDJSON mode for scripts, evals, and other agents.

  my-pi --mode rpc
    RPC mode over stdin/stdout JSONL for orchestrators and teammate sessions.

NOTES

  - In non-interactive modes, my-pi keeps headless-capable built-ins like
    MCP, LSP, prompt presets, recall, nopeek, Omnisearch, SQLite tools, hooks, and secret redaction.
  - UI-only built-ins like session auto-naming are skipped.
  - Repeat -e / --extension to compose multiple extensions.

NESTED RUNS

  - Child runs inherit cwd and environment unless you isolate them explicitly.
  - Use --agent-dir to isolate auth, config, sessions, and telemetry state.
  - For safer evals or unknown repos, use --untrusted plus an explicit
    --system-prompt.

EXAMPLES

  my-pi
  my-pi "fix the failing test"
  my-pi -P "summarize this repo"
  my-pi --json "list all TODO comments"
  echo "plan a login page" | my-pi --json
  my-pi --telemetry --json "run eval case"
  my-pi --telemetry --telemetry-db ./tmp/evals.db --json "run case"
  my-pi observability
  my-pi --untrusted --agent-dir /tmp/pi-agent --json "run case"
  my-pi -e ./my-ext.ts -e ./other-ext.ts "hello"
  my-pi -m claude-haiku-4-5-20241022 "explain this file"
  XIAOMI_API_KEY=... my-pi -m xiaomi/mimo-v2.5-pro "summarize this repo"
  my-pi -m cloudflare-workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast "explain this file"
  my-pi --preset terse,no-purple-prose "summarize this repo"
  my-pi --system-prompt "You are a JSON classifier. Return only JSON." --json "classify this"

PROMPT PRESETS

  Interactive commands:
    /prompt-preset help
    /prompt-preset export-defaults
    /prompt-preset edit-global terse
    /prompt-preset base detailed
    /prompt-preset enable bullets

  Short alias: /preset

  Editable preset files:
    ~/.pi/agent/presets/*.md
    .pi/presets/*.md
`;

async function render_rich_usage(
	cmd: any,
	parent?: any,
): Promise<string> {
	return `${await (renderUsage as any)(cmd, parent)}\n${HELP_APPENDIX}`;
}

async function print_usage(cmd: any, parent?: any): Promise<void> {
	console.log(await render_rich_usage(cmd, parent));
}

const main = defineCommand({
	meta: {
		name: 'my-pi',
		version: pkg.version,
		description:
			'Composable pi coding agent with MCP, LSP, presets, and local eval telemetry',
	},
	args: {
		print: {
			type: 'boolean',
			alias: 'P',
			description: 'Print mode (non-interactive, one-shot)',
			default: false,
		},
		'agent-dir': {
			type: 'string',
			description:
				'Override Pi auth/config/session directory for this process',
			required: false,
		},
		'session-dir': {
			type: 'string',
			description:
				'Override Pi session storage directory for this process',
			required: false,
		},
		json: {
			type: 'boolean',
			alias: 'j',
			description: 'Output NDJSON events (for agent consumption)',
			default: false,
		},
		mode: {
			type: 'string',
			description: 'Runtime mode: interactive, print, json, or rpc',
			required: false,
		},
		extension: {
			type: 'string',
			alias: 'e',
			description:
				'Extension path to load; repeatable via argv parsing',
			required: false,
		},
		'no-builtin': {
			type: 'boolean',
			description: 'Disable all built-in extensions',
			default: false,
		},
		untrusted: {
			type: 'boolean',
			description:
				'Safe mode for unknown repos: skip project MCP, hooks, project prompt presets, project skills, and project LSP binaries unless explicitly re-enabled',
			default: false,
		},
		...create_builtin_disable_cli_args(),
		telemetry: {
			type: 'boolean',
			description: 'Enable local SQLite telemetry for this process',
			default: false,
		},
		'no-telemetry': {
			type: 'boolean',
			description: 'Disable local SQLite telemetry for this process',
			default: false,
		},
		'telemetry-db': {
			type: 'string',
			description:
				'Override telemetry database path for this process',
			required: false,
		},
		model: {
			type: 'string',
			alias: 'm',
			description:
				'Model to use (e.g. claude-sonnet-4-5-20241022, gpt-5.4, cloudflare-workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast)',
		},
		thinking: {
			type: 'string',
			description:
				'Thinking level: off, minimal, low, medium, high, or xhigh',
			required: false,
		},
		tools: {
			type: 'string',
			alias: 't',
			description:
				'Comma-separated allowlist of tool names to enable',
			required: false,
		},
		'exclude-tools': {
			type: 'string',
			alias: 'xt',
			description: 'Comma-separated list of tool names to disable',
			required: false,
		},
		session: {
			type: 'string',
			description: 'Resume a specific session file or session ID',
			required: false,
		},
		'session-id': {
			type: 'string',
			description:
				'Create or resume an exact project-local session ID',
			required: false,
		},
		name: {
			type: 'string',
			alias: 'n',
			description: 'Set the session display name at startup',
			required: false,
		},
		skill: {
			type: 'string',
			description: 'Skill name to allow; repeatable in argv parsing',
			required: false,
		},
		'system-prompt': {
			type: 'string',
			description: 'Replace the base system prompt',
			required: false,
		},
		'append-system-prompt': {
			type: 'string',
			description: 'Append one-off instructions to the system prompt',
			required: false,
		},
		prompt: {
			type: 'string',
			alias: 'p',
			description: 'Prompt text (alternative to positional argument)',
			required: false,
		},
	},
	async run({ args }) {
		const cwd = process.cwd();
		const extension_paths = parse_extension_paths(process.argv, cwd);
		const selected_tools = parse_tool_allowlist(process.argv);
		const excluded_tools = parse_tool_excludelist(process.argv);
		const selected_skills = parse_skill_allowlist(process.argv);
		let selected_thinking;
		try {
			selected_thinking = parse_thinking_level(args.thinking);
		} catch (error) {
			console.error(
				error instanceof Error ? error.message : String(error),
			);
			process.exit(1);
		}

		let runtime_mode: 'interactive' | 'print' | 'json' | 'rpc' =
			'interactive';
		if (args.mode) {
			const requested = String(args.mode).trim().toLowerCase();
			if (
				!['interactive', 'print', 'json', 'rpc'].includes(requested)
			) {
				console.error(
					'Error: --mode must be one of interactive, print, json, rpc.',
				);
				process.exit(1);
			}
			runtime_mode = requested as
				| 'interactive'
				| 'print'
				| 'json'
				| 'rpc';
		}
		if (args.json) runtime_mode = 'json';
		else if (args.print) runtime_mode = 'print';

		const positionals = (args as any)._ as string[] | undefined;
		if (positionals?.[0] === 'observability') {
			const { start_observability_server } =
				await import('@spences10/pi-observability/server');
			start_observability_server();
			return;
		}

		// Resolve prompt: named --prompt flag > positional > stdin
		let prompt = args.prompt;
		if (!prompt && positionals && positionals.length > 0) {
			prompt = positionals[0];
		}
		if (!prompt && !process.stdin.isTTY && runtime_mode !== 'rpc') {
			prompt = await read_stdin();
		}
		if (prompt && runtime_mode === 'interactive')
			runtime_mode = 'print';

		if (
			!args.print &&
			!args.json &&
			runtime_mode !== 'rpc' &&
			!prompt &&
			!process.stdout.isTTY
		) {
			await print_usage(main as any);
			return;
		}

		// Startup feedback so silence = broken (issue #3)
		if (runtime_mode !== 'interactive') {
			process.stderr.write(
				`my-pi: connecting to ${args.model || 'default model'}...\n`,
			);
		}

		if (args.telemetry && args['no-telemetry']) {
			console.error(
				'Error: --telemetry and --no-telemetry cannot be used together.',
			);
			process.exit(1);
		}
		if (args.session && args['session-id']) {
			console.error(
				'Error: --session and --session-id cannot be used together.',
			);
			process.exit(1);
		}

		let telemetry_override: boolean | undefined;
		if (args.telemetry) {
			telemetry_override = true;
		} else if (args['no-telemetry']) {
			telemetry_override = false;
		}

		const [
			{ create_my_pi },
			{ InteractiveMode, runPrintMode, runRpcMode },
		] = await Promise.all([
			import('./api.js'),
			import('@earendil-works/pi-coding-agent'),
		]);

		const runtime = await create_my_pi({
			cwd,
			agent_dir: args['agent-dir'],
			session_dir: args['session-dir'],
			extensions: extension_paths,
			runtime_mode,
			...resolve_builtin_extension_options(args),
			telemetry: telemetry_override,
			telemetry_db_path: args['telemetry-db'],
			model: args.model,
			thinking: selected_thinking,
			selected_tools,
			excluded_tools,
			selected_skills,
			session: args.session,
			session_id: args['session-id'],
			startup_session_name: args.name,
			system_prompt: args['system-prompt'],
			append_system_prompt: args['append-system-prompt'],
			untrusted_repo: args.untrusted,
		});

		if (runtime_mode === 'rpc') {
			await runRpcMode(runtime);
		} else if (args.print || args.json || prompt) {
			let output_mode: 'json' | 'text' = 'text';
			if (args.json) {
				output_mode = 'json';
			}
			const code = await runPrintMode(runtime, {
				mode: output_mode,
				initialMessage: prompt || '',
				initialImages: [],
				messages: [],
			});
			process.exit(code);
		} else if (!process.stdout.isTTY) {
			await print_usage(main as any);
		} else {
			await run_interactive_mode(runtime, InteractiveMode);
		}
	},
});

void runMain(main as any, {
	showUsage: async (cmd: any, parent: any) => {
		await print_usage(cmd, parent);
	},
});
