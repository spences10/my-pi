#!/usr/bin/env node

// CLI for my-pi — composable pi coding agent
// Extension stacking patterns inspired by https://github.com/disler/pi-vs-claude-code

import {
	InteractiveMode,
	runPrintMode,
	runRpcMode,
} from '@mariozechner/pi-coding-agent';
import { defineCommand, renderUsage, runMain } from 'citty';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { create_my_pi } from './api.js';
import {
	parse_extension_paths,
	parse_skill_allowlist,
	parse_thinking_level,
	parse_tool_allowlist,
} from './cli-args.js';

// Suppress node:sqlite ExperimentalWarning without removing host listeners.
process.on('warning', (warning) => {
	if (warning.name !== 'ExperimentalWarning') {
		console.warn(warning);
	}
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
	readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'),
);

async function read_stdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks).toString('utf-8').trim();
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
    MCP, LSP, prompt presets, recall, nopeek, Omnisearch, SQLite tools, hooks, and output filtering.
  - UI-only built-ins like session auto-naming are skipped.
  - Repeat -e / --extension to stack multiple extensions.

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
  my-pi --untrusted --agent-dir /tmp/pi-agent --json "run case"
  my-pi -e ./my-ext.ts -e ./other-ext.ts "hello"
  my-pi -m claude-haiku-4-5-20241022 "explain this file"
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
		'no-mcp': {
			type: 'boolean',
			description: 'Disable built-in MCP extension',
			default: false,
		},
		'no-skills': {
			type: 'boolean',
			description: 'Disable built-in skills extension',
			default: false,
		},
		'no-filter': {
			type: 'boolean',
			description: 'Disable secret redaction in tool output',
			default: false,
		},
		'no-recall': {
			type: 'boolean',
			description: 'Disable recall extension',
			default: false,
		},
		'no-nopeek': {
			type: 'boolean',
			description: 'Disable nopeek reminder extension',
			default: false,
		},
		'no-omnisearch': {
			type: 'boolean',
			description: 'Disable mcp-omnisearch reminder extension',
			default: false,
		},
		'no-sqlite-tools': {
			type: 'boolean',
			description: 'Disable mcp-sqlite-tools reminder extension',
			default: false,
		},
		'no-prompt-presets': {
			type: 'boolean',
			description: 'Disable prompt presets extension',
			default: false,
		},
		'no-lsp': {
			type: 'boolean',
			description: 'Disable LSP extension',
			default: false,
		},
		'no-session-name': {
			type: 'boolean',
			description: 'Disable session name extension',
			default: false,
		},
		'no-confirm-destructive': {
			type: 'boolean',
			description: 'Disable destructive action confirmations',
			default: false,
		},
		'no-hooks': {
			type: 'boolean',
			description: 'Disable Claude-style hook execution',
			default: false,
		},
		'no-team-mode': {
			type: 'boolean',
			description: 'Disable experimental team mode extension',
			default: false,
		},
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

		// Resolve prompt: named --prompt flag > positional > stdin
		let prompt = args.prompt;
		if (!prompt) {
			// Check for positional arguments (after citty strips flags)
			const positionals = (args as any)._ as string[] | undefined;
			if (positionals && positionals.length > 0) {
				prompt = positionals[0];
			}
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

		let telemetry_override: boolean | undefined;
		if (args.telemetry) {
			telemetry_override = true;
		} else if (args['no-telemetry']) {
			telemetry_override = false;
		}

		const runtime = await create_my_pi({
			cwd,
			agent_dir: args['agent-dir'],
			session_dir: args['session-dir'],
			extensions: extension_paths,
			runtime_mode,
			mcp: !args['no-builtin'] && !args['no-mcp'],
			skills: !args['no-builtin'] && !args['no-skills'],
			filter_output: !args['no-builtin'] && !args['no-filter'],
			recall: !args['no-builtin'] && !args['no-recall'],
			nopeek: !args['no-builtin'] && !args['no-nopeek'],
			omnisearch: !args['no-builtin'] && !args['no-omnisearch'],
			sqlite_tools: !args['no-builtin'] && !args['no-sqlite-tools'],
			prompt_presets:
				!args['no-builtin'] && !args['no-prompt-presets'],
			lsp: !args['no-builtin'] && !args['no-lsp'],
			session_name: !args['no-builtin'] && !args['no-session-name'],
			confirm_destructive:
				!args['no-builtin'] && !args['no-confirm-destructive'],
			hooks_resolution: !args['no-builtin'] && !args['no-hooks'],
			team_mode: !args['no-builtin'] && !args['no-team-mode'],
			telemetry: telemetry_override,
			telemetry_db_path: args['telemetry-db'],
			model: args.model,
			thinking: selected_thinking,
			selected_tools,
			selected_skills,
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
			const mode = new InteractiveMode(runtime, {
				migratedProviders: [],
				modelFallbackMessage: undefined,
				initialMessage: undefined,
				initialImages: [],
				initialMessages: [],
			});
			await mode.run();
		}
	},
});

void runMain(main as any, {
	showUsage: async (cmd: any, parent: any) => {
		await print_usage(cmd, parent);
	},
});
