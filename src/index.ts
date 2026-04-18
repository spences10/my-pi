#!/usr/bin/env node

// CLI for my-pi — composable pi coding agent
// Extension stacking patterns inspired by https://github.com/disler/pi-vs-claude-code

import {
	InteractiveMode,
	runPrintMode,
} from '@mariozechner/pi-coding-agent';
import { defineCommand, runMain } from 'citty';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { create_my_pi } from './api.js';

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

const main = defineCommand({
	meta: {
		name: 'my-pi',
		version: pkg.version,
		description:
			'Composable pi coding agent with MCP tools and extension stacking',
	},
	args: {
		print: {
			type: 'boolean',
			alias: 'P',
			description: 'Print mode (non-interactive, one-shot)',
			default: false,
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
		'no-chain': {
			type: 'boolean',
			description: 'Disable built-in chain extension',
			default: false,
		},
		'no-filter': {
			type: 'boolean',
			description: 'Disable secret redaction in tool output',
			default: false,
		},
		'no-handoff': {
			type: 'boolean',
			description: 'Disable handoff extension',
			default: false,
		},
		'no-recall': {
			type: 'boolean',
			description: 'Disable recall extension',
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

		// Startup feedback so silence = broken (issue #3)
		if (args.print || args.json || prompt) {
			process.stderr.write(
				`my-pi: connecting to ${args.model || 'default model'}...\n`,
			);
		}

		const runtime = await create_my_pi({
			cwd,
			extensions: extension_paths,
			mcp: !args['no-builtin'] && !args['no-mcp'],
			skills: !args['no-builtin'] && !args['no-skills'],
			chain: !args['no-builtin'] && !args['no-chain'],
			filter_output: !args['no-builtin'] && !args['no-filter'],
			handoff: !args['no-builtin'] && !args['no-handoff'],
			recall: !args['no-builtin'] && !args['no-recall'],
			prompt_presets:
				!args['no-builtin'] && !args['no-prompt-presets'],
			lsp: !args['no-builtin'] && !args['no-lsp'],
			model: args.model,
			system_prompt: args['system-prompt'],
			append_system_prompt: args['append-system-prompt'],
		});

		if (args.print || args.json || prompt) {
			const code = await runPrintMode(runtime, {
				mode: args.json ? 'json' : 'text',
				initialMessage: prompt || '',
				initialImages: [],
				messages: [],
			});
			process.exit(code);
		} else if (!process.stdout.isTTY) {
			console.log(
				`my-pi v${pkg.version} — composable pi coding agent\n`,
			);
			console.log('Usage:');
			console.log(
				'  my-pi "prompt"                   One-shot print mode',
			);
			console.log(
				'  my-pi                            Interactive TUI mode',
			);
			console.log(
				'  my-pi -P "prompt"                Explicit print mode',
			);
			console.log(
				'  my-pi --json "prompt"            NDJSON output for agents',
			);
			console.log(
				'  my-pi -e ext.ts                  Stack an extension',
			);
			console.log(
				'  my-pi -e a.ts -e b.ts            Stack multiple extensions',
			);
			console.log(
				'  echo "prompt" | my-pi --json     Pipe stdin as prompt',
			);
			console.log(
				'  my-pi -m claude-haiku-4-5-20241022  Set initial model',
			);
			console.log(
				'  my-pi --no-builtin -e ext.ts     Skip all built-in extensions',
			);
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

void runMain(main);
