// Agent chain extension — sequential pipeline orchestrator
// Inspired by https://github.com/disler/pi-vs-claude-code/blob/main/extensions/agent-chain.ts

import {
	type ExtensionFactory,
	defineTool,
	parseFrontmatter,
} from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ── Types ───────────────────────────────────────

interface ChainStep {
	agent: string;
	prompt: string;
}

interface ChainDef {
	name: string;
	description: string;
	steps: ChainStep[];
}

interface AgentDef {
	name: string;
	description: string;
	tools: string;
	systemPrompt: string;
}

// ── YAML parser (minimal, no dep) ──────────────

function parse_chain_yaml(raw: string): ChainDef[] {
	const chains: ChainDef[] = [];
	let current: ChainDef | null = null;
	let currentStep: ChainStep | null = null;

	for (const line of raw.split('\n')) {
		const chainMatch = line.match(/^(\S[^:]*):$/);
		if (chainMatch) {
			if (current && currentStep) {
				current.steps.push(currentStep);
				currentStep = null;
			}
			current = {
				name: chainMatch[1].trim(),
				description: '',
				steps: [],
			};
			chains.push(current);
			continue;
		}

		const descMatch = line.match(/^\s+description:\s+(.+)$/);
		if (descMatch && current && !currentStep) {
			let desc = descMatch[1].trim();
			if (
				(desc.startsWith('"') && desc.endsWith('"')) ||
				(desc.startsWith("'") && desc.endsWith("'"))
			) {
				desc = desc.slice(1, -1);
			}
			current.description = desc;
			continue;
		}

		if (line.match(/^\s+steps:\s*$/) && current) continue;

		const agentMatch = line.match(/^\s+-\s+agent:\s+(.+)$/);
		if (agentMatch && current) {
			if (currentStep) current.steps.push(currentStep);
			currentStep = {
				agent: agentMatch[1].trim(),
				prompt: '',
			};
			continue;
		}

		const promptMatch = line.match(/^\s+prompt:\s+(.+)$/);
		if (promptMatch && currentStep) {
			let prompt = promptMatch[1].trim();
			if (
				(prompt.startsWith('"') && prompt.endsWith('"')) ||
				(prompt.startsWith("'") && prompt.endsWith("'"))
			) {
				prompt = prompt.slice(1, -1);
			}
			prompt = prompt.replace(/\\n/g, '\n');
			currentStep.prompt = prompt;
			continue;
		}
	}

	if (current && currentStep) {
		current.steps.push(currentStep);
	}

	return chains;
}

// ── Agent file parser ──────────────────────────

function parse_agent_file(filePath: string): AgentDef | null {
	try {
		const raw = readFileSync(filePath, 'utf-8');
		const { frontmatter, body } = parseFrontmatter<{
			name?: string;
			description?: string;
			tools?: string;
		}>(raw);

		if (!frontmatter?.name) return null;

		return {
			name: frontmatter.name,
			description: frontmatter.description || '',
			tools: frontmatter.tools || 'read,grep,find,ls',
			systemPrompt: body.trim(),
		};
	} catch {
		return null;
	}
}

function scan_agent_dirs(cwd: string): Map<string, AgentDef> {
	const dirs = [
		join(cwd, 'agents'),
		join(cwd, '.claude', 'agents'),
		join(cwd, '.pi', 'agents'),
	];

	const agents = new Map<string, AgentDef>();

	for (const dir of dirs) {
		if (!existsSync(dir)) continue;
		try {
			for (const file of readdirSync(dir)) {
				if (!file.endsWith('.md')) continue;
				const def = parse_agent_file(resolve(dir, file));
				if (def && !agents.has(def.name.toLowerCase())) {
					agents.set(def.name.toLowerCase(), def);
				}
			}
		} catch {
			// skip inaccessible dirs
		}
	}

	return agents;
}

// ── Run a single agent step via my-pi print mode ─

function run_agent_step(
	agentDef: AgentDef,
	task: string,
): Promise<{ output: string; exitCode: number }> {
	// Use the current process (my-pi) in print mode
	const bin = process.argv[1];
	const args = ['--no-builtin', '-P', task];

	const chunks: string[] = [];

	return new Promise((res) => {
		const proc = spawn(process.execPath, [bin, ...args], {
			stdio: ['ignore', 'pipe', 'pipe'],
			env: {
				...process.env,
				MY_PI_AGENT_SYSTEM_PROMPT: agentDef.systemPrompt,
			},
		});

		proc.stdout!.setEncoding('utf-8');
		proc.stdout!.on('data', (chunk: string) => {
			chunks.push(chunk);
		});

		proc.stderr!.setEncoding('utf-8');
		proc.stderr!.on('data', () => {});

		proc.on('close', (code) => {
			res({
				output: chunks.join('').trim(),
				exitCode: code ?? 1,
			});
		});

		proc.on('error', (err) => {
			res({
				output: `Error spawning agent: ${err.message}`,
				exitCode: 1,
			});
		});
	});
}

// ── Extension ──────────────────────────────────

export function create_chain_extension(
	cwd: string,
): ExtensionFactory {
	return async (pi) => {
		const agents = scan_agent_dirs(cwd);
		let chains: ChainDef[] = [];
		let activeChain: ChainDef | null = null;

		// Load chain definitions
		const chain_paths = [
			join(cwd, '.pi', 'agents', 'agent-chain.yaml'),
			join(cwd, '.pi', 'agents', 'chains.yaml'),
			join(cwd, '.claude', 'agents', 'chains.yaml'),
		];

		for (const path of chain_paths) {
			if (existsSync(path)) {
				try {
					chains = parse_chain_yaml(readFileSync(path, 'utf-8'));
					break;
				} catch {
					// try next
				}
			}
		}

		if (chains.length > 0) {
			activeChain = chains[0];
		}

		// ── run_chain tool ─────────────────────────

		pi.registerTool(
			defineTool({
				name: 'run_chain',
				label: 'Run Chain',
				description:
					"Execute the active agent chain pipeline. Each step runs sequentially — output from one step feeds into the next as $INPUT. $ORIGINAL is always the user's initial prompt.",
				parameters: Type.Object({
					task: Type.String({
						description: 'The task/prompt for the chain to process',
					}),
				}),
				execute: async (
					_id: string,
					params: unknown,
				): Promise<{
					content: Array<{ type: 'text'; text: string }>;
					details: { chain: string; steps: number };
				}> => {
					const { task } = params as { task: string };

					if (!activeChain) {
						return {
							content: [
								{
									type: 'text' as const,
									text: 'No chain active. Use /chain to select one.',
								},
							],
							details: {
								chain: '',
								steps: 0,
							},
						};
					}

					let input = task;
					const original = task;
					const results: string[] = [];

					for (let i = 0; i < activeChain.steps.length; i++) {
						const step = activeChain.steps[i];
						const agentDef = agents.get(step.agent.toLowerCase());

						if (!agentDef) {
							const msg = `Step ${i + 1}: agent "${step.agent}" not found. Available: ${Array.from(agents.keys()).join(', ')}`;
							results.push(msg);
							return {
								content: [{ type: 'text' as const, text: msg }],
								details: {
									chain: activeChain.name,
									steps: i,
								},
							};
						}

						const resolvedPrompt = step.prompt
							.replace(/\$INPUT/g, input)
							.replace(/\$ORIGINAL/g, original);

						const result = await run_agent_step(
							agentDef,
							resolvedPrompt,
						);

						if (result.exitCode !== 0) {
							const msg = `Step ${i + 1} (${step.agent}) failed:\n${result.output}`;
							results.push(msg);
							return {
								content: [{ type: 'text' as const, text: msg }],
								details: {
									chain: activeChain.name,
									steps: i + 1,
								},
							};
						}

						results.push(
							`## Step ${i + 1}: ${step.agent}\n${result.output}`,
						);
						input = result.output;
					}

					const summary = results.join('\n\n---\n\n');
					return {
						content: [{ type: 'text' as const, text: summary }],
						details: {
							chain: activeChain.name,
							steps: activeChain.steps.length,
						},
					};
				},
			}),
		);

		// ── /chain command ─────────────────────────

		pi.registerCommand('chain', {
			description: 'Switch active chain or list chains (chain list)',
			getArgumentCompletions: (prefix) => {
				const parts = prefix.trim().split(/\s+/);
				if (parts.length <= 1) {
					const subs = ['list', ...chains.map((c) => c.name)];
					return subs
						.filter((s) => s.startsWith(parts[0] || ''))
						.map((s) => ({ value: s, label: s }));
				}
				return null;
			},
			handler: async (args, ctx) => {
				const sub = args.trim();

				if (!sub || sub === 'list') {
					if (chains.length === 0) {
						ctx.ui.notify(
							'No chains found. Add chains to .pi/agents/agent-chain.yaml',
							'warning',
						);
						return;
					}
					const lines = chains.map((c) => {
						const active = c.name === activeChain?.name ? ' *' : '';
						const steps = c.steps.map((s) => s.agent).join(' -> ');
						return `${c.name}${active}: ${c.description || steps}`;
					});
					ctx.ui.notify(lines.join('\n'));
					return;
				}

				const chain = chains.find(
					(c) => c.name.toLowerCase() === sub.toLowerCase(),
				);
				if (!chain) {
					ctx.ui.notify(
						`Unknown chain: ${sub}. Use /chain list.`,
						'warning',
					);
					return;
				}

				activeChain = chain;
				const flow = chain.steps.map((s) => s.agent).join(' -> ');
				ctx.ui.notify(`Active chain: ${chain.name} (${flow})`);
			},
		});

		// ── System prompt injection ────────────────

		pi.on(
			'before_agent_start',
			async (event: { systemPrompt: string }) => {
				if (!activeChain || chains.length === 0) return {};

				const flow = activeChain.steps
					.map((s) => s.agent)
					.join(' -> ');

				const stepList = activeChain.steps
					.map((s, i) => {
						const def = agents.get(s.agent.toLowerCase());
						const desc = def?.description || 'unknown';
						return `${i + 1}. **${s.agent}** — ${desc}`;
					})
					.join('\n');

				const chainList = chains
					.map((c) => {
						const active =
							c.name === activeChain?.name ? ' (active)' : '';
						return `- ${c.name}${active}: ${c.description}`;
					})
					.join('\n');

				// Append chain context to the existing system prompt
				return {
					systemPrompt:
						event.systemPrompt +
						`

## Agent Chains

You have a run_chain tool that executes sequential agent pipelines.

### Active Chain: ${activeChain.name}
${activeChain.description}
Flow: ${flow}

${stepList}

### Available Chains
${chainList}

### When to use run_chain
- Non-trivial work: features, refactors, multi-file changes
- Tasks that benefit from planning then building then reviewing
- When structured multi-agent collaboration helps

### When to work directly
- Simple reads, quick lookups, small edits
- Answering questions about the codebase
- Anything you can handle in one step

Switch chains with /chain <name>.`,
				};
			},
		);

		// ── /agents command ────────────────────────

		pi.registerCommand('agents', {
			description: 'List discovered agent definitions',
			handler: async (_args, ctx) => {
				if (agents.size === 0) {
					ctx.ui.notify(
						'No agents found in agents/, .pi/agents/, or .claude/agents/',
						'warning',
					);
					return;
				}
				const lines = Array.from(agents.values()).map(
					(a) =>
						`${a.name}: ${a.description || '(no description)'} [${a.tools}]`,
				);
				ctx.ui.notify(lines.join('\n'));
			},
		});
	};
}
