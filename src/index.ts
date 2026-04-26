#!/usr/bin/env node

// CLI for my-pi — composable pi coding agent
// Extension stacking patterns inspired by https://github.com/disler/pi-vs-claude-code

import {
	InteractiveMode,
	runPrintMode,
} from '@mariozechner/pi-coding-agent';
import { defineCommand, renderUsage, runMain } from 'citty';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { create_my_pi } from './api.js';

// Suppress node:sqlite ExperimentalWarning
process.removeAllListeners('warning');
process.on('warning', (warning) => {
	if (warning.name !== 'ExperimentalWarning') {
		console.warn(warning);
	}
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
	readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'),
);

// citty can't handle repeatable args, so parse -e from argv directly
// (citty uses strict: false, so unknown flags are silently ignored)
function parse_extension_paths(argv: string[]): string[] {
	const paths: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		if (
			(argv[i] === '-e' || argv[i] === '--extension') &&
			i + 1 < argv.length
		) {
			paths.push(resolve(argv[++i]));
		}
	}
	return paths;
}

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

NOTES

  - In non-interactive modes, my-pi keeps headless-capable built-ins like
    MCP, LSP, prompt presets, recall, nopeek, Omnisearch, SQLite tools, hooks, and output filtering.
  - UI-only built-ins like session auto-naming are skipped.
  - Repeat -e / --extension to stack multiple extensions.

NESTED RUNS

  - Child runs inherit cwd and environment unless you isolate them explicitly.
  - Use --agent-dir to isolate auth, config, sessions, and telemetry state.
  - For safer evals, consider --no-mcp and --no-hooks plus an explicit
    --system-prompt.

EXAMPLES

  my-pi
  my-pi "fix the failing test"
  my-pi -P "summarize this repo"
  my-pi --json "list all TODO comments"
  echo "plan a login page" | my-pi --json
  my-pi --telemetry --json "run eval case"
  my-pi --telemetry --telemetry-db ./tmp/evals.db --json "run case"
  my-pi --agent-dir /tmp/pi-agent --json "run case"
  my-pi -e ./my-ext.ts -e ./other-ext.ts "hello"
  my-pi -m claude-haiku-4-5-20241022 "explain this file"
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
		json: {
			type: 'boolean',
			alias: 'j',
			description: 'Output NDJSON events (for agent consumption)',
			default: false,
		},
		'no-builtin': {
			type: 'boolean',
			description: 'Disable all built-in extensions',
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
				'Model to use (e.g. claude-sonnet-4-5-20241022, gpt-5.4)',
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
		const extension_paths = parse_extension_paths(process.argv);

		// Resolve prompt: named --prompt flag > positional > stdin
		let prompt = args.prompt;
		if (!prompt) {
			// Check for positional arguments (after citty strips flags)
			const positionals = (args as any)._ as string[] | undefined;
			if (positionals && positionals.length > 0) {
				prompt = positionals[0];
			}
		}
		if (!prompt && !process.stdin.isTTY) {
			prompt = await read_stdin();
		}

		// Model validation (issue #5)
		if (args.model && /[/\\]/.test(args.model)) {
			console.error(
				`Error: Invalid model "${args.model}". Use bare model names without provider prefixes.`,
			);
			console.error(
				`  Examples: claude-sonnet-4-5-20241022, gpt-5.4, mistral-large`,
			);
			process.exit(1);
		}

		if (
			!args.print &&
			!args.json &&
			!prompt &&
			!process.stdout.isTTY
		) {
			await print_usage(main as any);
			return;
		}

		// Startup feedback so silence = broken (issue #3)
		if (args.print || args.json || prompt) {
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

		let runtime_mode: 'interactive' | 'print' | 'json' =
			'interactive';
		if (args.json) {
			runtime_mode = 'json';
		} else if (args.print || prompt) {
			runtime_mode = 'print';
		}

		const runtime = await create_my_pi({
			cwd,
			agent_dir: args['agent-dir'],
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
			telemetry: telemetry_override,
			telemetry_db_path: args['telemetry-db'],
			model: args.model,
			system_prompt: args['system-prompt'],
			append_system_prompt: args['append-system-prompt'],
		});

		if (args.print || args.json || prompt) {
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
