#!/usr/bin/env node

import {
	type CreateAgentSessionRuntimeFactory,
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
import { create_mcp_tools } from './mcp/bridge.js';
import { load_mcp_config } from './mcp/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
	readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'),
);

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

		// Load MCP servers from mcp.json
		const mcp_configs = load_mcp_config(cwd);
		const mcp =
			mcp_configs.length > 0
				? await create_mcp_tools(mcp_configs)
				: null;

		const createRuntime: CreateAgentSessionRuntimeFactory = async ({
			cwd: runtime_cwd,
			sessionManager,
			sessionStartEvent,
		}) => {
			const services = await createAgentSessionServices({
				cwd: runtime_cwd,
			});

			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
					customTools: mcp?.tools,
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

		if (mcp_configs.length > 0) {
			const names = mcp_configs.map((c) => c.name).join(', ');
			console.error(`MCP servers: ${names}`);
		}

		if (args.print || args.prompt) {
			await runPrintMode(runtime, {
				mode: 'text',
				initialMessage: args.prompt || '',
				initialImages: [],
				messages: [],
			});
			await mcp?.cleanup();
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
