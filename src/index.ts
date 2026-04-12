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
		model: {
			type: 'string',
			alias: 'm',
			description: 'Model to use (e.g. claude-sonnet-4-5-20241022)',
		},
		prompt: {
			type: 'positional',
			description: 'Initial prompt (optional)',
			required: false,
		},
	},
	async run({ args }) {
		const cwd = process.cwd();
		const extension_paths = parse_extension_paths(process.argv);

		// Stdin piping: read all stdin as prompt when piped
		let prompt = args.prompt;
		if (!prompt && !process.stdin.isTTY) {
			prompt = await read_stdin();
		}

		const runtime = await create_my_pi({
			cwd,
			extensions: extension_paths,
			mcp: !args['no-builtin'] && !args['no-mcp'],
			skills: !args['no-builtin'] && !args['no-skills'],
			chain: !args['no-builtin'] && !args['no-chain'],
			model: args.model,
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
				'  my-pi --no-builtin -e ext.ts     Skip mcp+skills builtins',
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
