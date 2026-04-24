// Agent chain extension — sequential pipeline orchestrator
// Inspired by https://github.com/disler/pi-vs-claude-code/blob/main/extensions/agent-chain.ts

import {
	type BeforeAgentStartEvent,
	type ExtensionAPI,
	defineTool,
	parseFrontmatter,
} from '@mariozechner/pi-coding-agent';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
	let current_step: ChainStep | null = null;

	for (const line of raw.split('\n')) {
		const chain_match = line.match(/^(\S[^:]*):$/);
		if (chain_match) {
			if (current && current_step) {
				current.steps.push(current_step);
				current_step = null;
			}
			current = {
				name: chain_match[1].trim(),
				description: '',
				steps: [],
			};
			chains.push(current);
			continue;
		}

		const desc_match = line.match(/^\s+description:\s+(.+)$/);
		if (desc_match && current && !current_step) {
			let desc = desc_match[1].trim();
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

		const agent_match = line.match(/^\s+-\s+agent:\s+(.+)$/);
		if (agent_match && current) {
			if (current_step) current.steps.push(current_step);
			current_step = {
				agent: agent_match[1].trim(),
				prompt: '',
			};
			continue;
		}

		const prompt_match = line.match(/^\s+prompt:\s+(.+)$/);
		if (prompt_match && current_step) {
			let prompt = prompt_match[1].trim();
			if (
				(prompt.startsWith('"') && prompt.endsWith('"')) ||
				(prompt.startsWith("'") && prompt.endsWith("'"))
			) {
				prompt = prompt.slice(1, -1);
			}
			prompt = prompt.replace(/\\n/g, '\n');
			current_step.prompt = prompt;
			continue;
		}
	}

	if (current && current_step) {
		current.steps.push(current_step);
	}

	return chains;
}

export function should_inject_chain_prompt(
	event: Pick<BeforeAgentStartEvent, 'systemPromptOptions'>,
): boolean {
	const selected_tools = event.systemPromptOptions?.selectedTools;
	return !selected_tools || selected_tools.includes('run_chain');
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

const AGENT_STEP_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function run_agent_step(
	agent_def: AgentDef,
	task: string,
	model?: string,
): Promise<{ output: string; exitCode: number }> {
	// Resolve bin path: prefer known dist location over process.argv[1]
	// (process.argv[1] may point to a wrapper like codex, not my-pi)
	const bin = join(__dirname, '..', 'index.js');
	const args = ['--no-builtin', '--json', '--prompt', task];
	if (model) {
		args.push('--model', model);
	}

	const chunks: string[] = [];

	return new Promise((res) => {
		let settled = false;
		const resolve_once = (result: {
			output: string;
			exitCode: number;
		}) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			res(result);
		};

		const proc = spawn(process.execPath, [bin, ...args], {
			stdio: ['ignore', 'pipe', 'pipe'],
			env: {
				...process.env,
				MY_PI_AGENT_SYSTEM_PROMPT: agent_def.systemPrompt,
			},
		});

		const timer = setTimeout(() => {
			proc.kill('SIGTERM');
			resolve_once({
				output: `Agent step timed out after ${AGENT_STEP_TIMEOUT_MS / 1000}s`,
				exitCode: 1,
			});
		}, AGENT_STEP_TIMEOUT_MS);

		proc.stdout!.setEncoding('utf-8');
		proc.stdout!.on('data', (chunk: string) => {
			chunks.push(chunk);
		});

		proc.stderr!.setEncoding('utf-8');
		proc.stderr!.on('data', () => {});

		proc.on('close', (code) => {
			// Parse NDJSON events to extract assistant text content
			const raw = chunks.join('');
			const text_parts: string[] = [];
			for (const line of raw.split('\n')) {
				if (!line.trim()) continue;
				try {
					const event = JSON.parse(line);
					if (
						event?.role === 'assistant' &&
						Array.isArray(event?.content)
					) {
						for (const c of event.content) {
							if (c.type === 'text' && c.text) {
								text_parts.push(c.text);
							}
						}
					}
				} catch {
					// not JSON — use raw line
					text_parts.push(line);
				}
			}
			resolve_once({
				output: text_parts.join('\n').trim() || raw.trim(),
				exitCode: code ?? 1,
			});
		});

		proc.on('error', (err) => {
			resolve_once({
				output: `Error spawning agent: ${err.message}`,
				exitCode: 1,
			});
		});
	});
}

// ── Extension ──────────────────────────────────

// Default export for Pi Package / additionalExtensionPaths loading
function parse_model_from_argv(): string | undefined {
	const argv = process.argv;
	for (let i = 0; i < argv.length; i++) {
		if (
			(argv[i] === '--model' || argv[i] === '-m') &&
			i + 1 < argv.length
		) {
			return argv[i + 1];
		}
		if (argv[i]?.startsWith('--model=')) {
			return argv[i].slice('--model='.length);
		}
	}
	return undefined;
}

export default async function chain(pi: ExtensionAPI) {
	const cwd = process.cwd();
	const agents = scan_agent_dirs(cwd);
	const current_model = parse_model_from_argv();
	let chains: ChainDef[] = [];
	let active_chain: ChainDef | null = null;

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
		active_chain = chains[0];
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

				if (!active_chain) {
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

				for (let i = 0; i < active_chain.steps.length; i++) {
					const step = active_chain.steps[i];
					const agent_def = agents.get(step.agent.toLowerCase());

					if (!agent_def) {
						const msg = `Step ${i + 1}: agent "${step.agent}" not found. Available: ${Array.from(agents.keys()).join(', ')}`;
						results.push(msg);
						return {
							content: [{ type: 'text' as const, text: msg }],
							details: {
								chain: active_chain.name,
								steps: i,
							},
						};
					}

					const resolved_prompt = step.prompt
						.replace(/\$INPUT/g, input)
						.replace(/\$ORIGINAL/g, original);

					const result = await run_agent_step(
						agent_def,
						resolved_prompt,
						current_model,
					);

					if (result.exitCode !== 0) {
						const msg = `Step ${i + 1} (${step.agent}) failed:\n${result.output}`;
						results.push(msg);
						return {
							content: [{ type: 'text' as const, text: msg }],
							details: {
								chain: active_chain.name,
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
						chain: active_chain.name,
						steps: active_chain.steps.length,
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
					const active = c.name === active_chain?.name ? ' *' : '';
					const steps = c.steps.map((s) => s.agent).join(' -> ');
					return `${c.name}${active}: ${c.description || steps}`;
				});
				ctx.ui.notify(lines.join('\n'));
				return;
			}

			const found_chain = chains.find(
				(c) => c.name.toLowerCase() === sub.toLowerCase(),
			);
			if (!found_chain) {
				ctx.ui.notify(
					`Unknown chain: ${sub}. Use /chain list.`,
					'warning',
				);
				return;
			}

			active_chain = found_chain;
			const flow = found_chain.steps.map((s) => s.agent).join(' -> ');
			ctx.ui.notify(`Active chain: ${found_chain.name} (${flow})`);
		},
	});

	// ── System prompt injection ────────────────

	pi.on(
		'before_agent_start',
		async (event: BeforeAgentStartEvent) => {
			if (!active_chain || chains.length === 0) return {};
			if (!should_inject_chain_prompt(event)) return {};

			const flow = active_chain.steps
				.map((s) => s.agent)
				.join(' -> ');

			const step_list = active_chain.steps
				.map((s, i) => {
					const def = agents.get(s.agent.toLowerCase());
					const desc = def?.description || 'unknown';
					return `${i + 1}. **${s.agent}** — ${desc}`;
				})
				.join('\n');

			const chain_list = chains
				.map((c) => {
					const active =
						c.name === active_chain?.name ? ' (active)' : '';
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

### Active Chain: ${active_chain.name}
${active_chain.description}
Flow: ${flow}

${step_list}

### Available Chains
${chain_list}

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
}
