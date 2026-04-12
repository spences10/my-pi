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
import { create_mcp_extension } from './extensions/mcp.js';
import { create_skills_extension } from './extensions/skills.js';
import { create_skills_manager } from './skills/manager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
	readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'),
);

const main = defineCommand({
	meta: {
		name: 'my-pi',
		version: pkg.version,
		description:
			'Personal pi coding agent with MCP tool integration',
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

		const createRuntime: CreateAgentSessionRuntimeFactory =
			async ({
				cwd: runtime_cwd,
				sessionManager,
				sessionStartEvent,
			}) => {
				const skills_mgr = create_skills_manager();
				const services =
					await createAgentSessionServices({
						cwd: runtime_cwd,
						resourceLoaderOptions: {
							extensionFactories: [
								create_mcp_extension(runtime_cwd),
								create_skills_extension(skills_mgr),
							],
							skillsOverride: (base) => ({
								skills: base.skills.filter((s) =>
									skills_mgr.is_enabled_by_skill(
										s.name,
										s.filePath,
									),
								),
								diagnostics: base.diagnostics,
							}),
						},
					});

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

		const runtime = await createAgentSessionRuntime(
			createRuntime,
			{
				cwd,
				agentDir,
				sessionManager: SessionManager.create(cwd),
			},
		);

		if (args.print || args.prompt) {
			await runPrintMode(runtime, {
				mode: 'text',
				initialMessage: args.prompt || '',
				initialImages: [],
				messages: [],
			});
		} else if (!process.stdout.isTTY) {
			console.log(
				`my-pi v${pkg.version} — pi coding agent with MCP tools\n`,
			);
			console.log('Usage:');
			console.log(
				'  my-pi "prompt"           One-shot print mode',
			);
			console.log(
				'  my-pi                    Interactive TUI mode',
			);
			console.log(
				'  my-pi -P "prompt"        Explicit print mode',
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
