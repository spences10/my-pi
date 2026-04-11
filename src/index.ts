#!/usr/bin/env node

import {
	type CreateAgentSessionRuntimeFactory,
	AuthStorage,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
	InteractiveMode,
	runPrintMode,
	SessionManager,
} from '@mariozechner/pi-coding-agent';
import { defineCommand, runMain } from 'citty';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
	readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'),
);

function injectApiKeys(authStorage: AuthStorage) {
	if (process.env.ANTHROPIC_API_KEY) {
		authStorage.setRuntimeApiKey(
			'anthropic',
			process.env.ANTHROPIC_API_KEY,
		);
	}
	if (process.env.MISTRAL_API_KEY) {
		authStorage.setRuntimeApiKey(
			'mistral',
			process.env.MISTRAL_API_KEY,
		);
	}
}

const main = defineCommand({
	meta: {
		name: 'my-pi',
		version: pkg.version,
		description: 'Personal pi coding agent with MCP tool integration',
	},
	args: {
		print: {
			type: 'boolean',
			alias: 'P',
			description: 'Print mode (non-interactive, one-shot)',
			default: false,
		},
		prompt: {
			type: 'positional',
			description: 'Initial prompt (optional)',
			required: false,
		},
	},
	async run({ args }) {
		const cwd = process.cwd();
		const agentDir = getAgentDir();

		const createRuntime: CreateAgentSessionRuntimeFactory = async ({
			cwd: runtimeCwd,
			sessionManager,
			sessionStartEvent,
		}) => {
			const services = await createAgentSessionServices({
				cwd: runtimeCwd,
			});

			// Inject API keys
			injectApiKeys(services.authStorage);

			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
				})),
				services,
				diagnostics: services.diagnostics,
			};
		};

		const runtime = await createAgentSessionRuntime(createRuntime, {
			cwd,
			agentDir,
			sessionManager: SessionManager.create(cwd),
		});

		if (args.print || args.prompt) {
			await runPrintMode(runtime, {
				mode: 'text',
				initialMessage: args.prompt || '',
				initialImages: [],
				messages: [],
			});
		} else if (!process.stdout.isTTY) {
			// Non-TTY without prompt: show help for LLM agents
			console.log(
				`my-pi v${pkg.version} — pi coding agent with MCP tools\n`,
			);
			console.log('Usage:');
			console.log('  my-pi "prompt"           One-shot print mode');
			console.log('  my-pi                    Interactive TUI mode');
			console.log('  my-pi -P "prompt"        Explicit print mode');
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
