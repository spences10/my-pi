import type {
	BeforeAgentStartEvent,
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { existsSync } from 'node:fs';
import {
	check_command_allowed,
	check_path_allowed,
} from './enforcement/policy.js';
import { harness_paths, read_contract } from './runtime/files.js';
import { HARNESS_SYSTEM_PROMPT } from './prompt.js';
import {
	active_harness_context,
	create_harness_runtime,
	format_harness_summary,
	update_harness_runtime,
} from './runtime/index.js';
import {
	HARNESS_CUSTOM_TYPE,
	harness_create_params_schema,
	harness_read_params_schema,
	harness_update_params_schema,
	type HarnessReadParams,
} from './schema.js';

function persist_active_harness(
	pi: ExtensionAPI,
	harness_dir: string | undefined,
): void {
	pi.appendEntry(HARNESS_CUSTOM_TYPE, {
		active_harness_dir: harness_dir,
	});
}

function restore_active_harness(
	ctx: ExtensionContext,
): string | undefined {
	const entries = ctx.sessionManager.getEntries() as Array<{
		type?: string;
		customType?: string;
		data?: { active_harness_dir?: string };
	}>;
	return entries
		.filter(
			(entry) =>
				entry.type === 'custom' &&
				entry.customType === HARNESS_CUSTOM_TYPE,
		)
		.pop()?.data?.active_harness_dir;
}

function update_harness_ui(
	ctx: ExtensionContext,
	harness_dir: string | undefined,
): void {
	if (
		!harness_dir ||
		!existsSync(harness_paths(harness_dir).contract)
	) {
		ctx.ui.setStatus('harness', undefined);
		ctx.ui.setWidget('harness', undefined);
		return;
	}
	const summary = format_harness_summary(harness_dir).split('\n');
	ctx.ui.setStatus(
		'harness',
		`🧪 ${summary[2]?.replace('Status: ', '')}`,
	);
	ctx.ui.setWidget('harness', summary.slice(0, 4));
}

function parse_command(args: string): {
	command: string;
	rest: string;
} {
	const [command = 'status', ...rest] = args.trim().split(/\s+/);
	return { command, rest: rest.join(' ').trim() };
}

function tool_text(text: string) {
	return { content: [{ type: 'text' as const, text }], details: {} };
}

export function should_inject_harness_prompt(
	event: Pick<BeforeAgentStartEvent, 'systemPromptOptions'>,
): boolean {
	const selected_tools = event.systemPromptOptions?.selectedTools;
	return !selected_tools || selected_tools.includes('bash');
}

export default async function harness(pi: ExtensionAPI) {
	let active_harness_dir: string | undefined;

	function set_active_harness(
		harness_dir: string | undefined,
		ctx: ExtensionContext,
	): void {
		active_harness_dir = harness_dir;
		persist_active_harness(pi, harness_dir);
		update_harness_ui(ctx, harness_dir);
	}

	pi.registerCommand('harness', {
		description:
			'Create, use, run, review, and inspect ephemeral /tmp task harnesses',
		handler: async (args, ctx) => {
			const { command, rest } = parse_command(args);
			if (command === 'clear') {
				set_active_harness(undefined, ctx);
				ctx.ui.notify('Cleared active harness', 'info');
				return;
			}
			if (command === 'use') {
				if (!rest) {
					ctx.ui.notify('Usage: /harness use <dir>', 'warning');
					return;
				}
				set_active_harness(rest, ctx);
				ctx.ui.notify(`Active harness: ${rest}`, 'info');
				return;
			}
			if (command === 'status') {
				const harness_dir = rest || active_harness_dir;
				if (!harness_dir) {
					ctx.ui.notify('No active harness', 'warning');
					return;
				}
				ctx.ui.notify(format_harness_summary(harness_dir), 'info');
				return;
			}
			if (command === 'create') {
				pi.sendUserMessage(
					`Use the create-harness skill to build a complete /tmp my-pi harness for this task. Use harness_create after context gathering. If the team tool is available, also create or reuse a team and add a team task whose description includes the harness directory.\n\n${rest}`,
				);
				return;
			}
			if (command === 'run') {
				const harness_dir = rest || active_harness_dir;
				if (!harness_dir) {
					ctx.ui.notify('Usage: /harness run <dir>', 'warning');
					return;
				}
				set_active_harness(harness_dir, ctx);
				pi.sendUserMessage(
					`Use the execute-harness skill to run this harness until validation completes: ${harness_dir}. If the team tool is available, create or reuse a team, create a task for this harness, spawn one worktree mutating teammate with member_spawn, and have that teammate execute the harness. Then inspect team status/results before reporting.`,
				);
				return;
			}
			if (command === 'review') {
				const harness_dir = rest || active_harness_dir;
				if (!harness_dir) {
					ctx.ui.notify('Usage: /harness review <dir>', 'warning');
					return;
				}
				set_active_harness(harness_dir, ctx);
				pi.sendUserMessage(
					`Use the review-harness skill to review drift, shortcuts, validation evidence, and remaining risks for: ${harness_dir}`,
				);
				return;
			}
			ctx.ui.notify(
				'Usage: /harness create|run|review|status|use|clear',
				'info',
			);
		},
	});

	pi.registerTool({
		name: 'harness_create',
		label: 'Create Harness',
		description:
			'Create an ephemeral /tmp my-pi task harness with machine-readable contract, prompts, scripts, logs, and status.',
		promptSnippet:
			'Create /tmp task harnesses for constrained agent execution',
		promptGuidelines: [
			'Use harness_create after context gathering for ambiguous or high-risk coding tasks.',
			'Treat harness.json as the execution contract and record progress with harness_update.',
		],
		parameters: harness_create_params_schema,
		async execute(_tool_call_id, params, _signal, _on_update, ctx) {
			const { harness_dir, contract } = create_harness_runtime(
				params,
				ctx.cwd,
			);
			set_active_harness(harness_dir, ctx);
			return tool_text(
				`Created harness ${contract.id}\n${format_harness_summary(harness_dir)}`,
			);
		},
	});

	pi.registerTool({
		name: 'harness_update',
		label: 'Update Harness',
		description:
			'Update harness status, phase, notes, and validation evidence.',
		parameters: harness_update_params_schema,
		async execute(_tool_call_id, params, _signal, _on_update, ctx) {
			const status_file = update_harness_runtime(params);
			set_active_harness(params.harness_dir, ctx);
			return tool_text(
				`Updated harness ${status_file.id}: ${status_file.status}`,
			);
		},
	});

	pi.registerTool({
		name: 'harness_read',
		label: 'Read Harness',
		description:
			'Read a harness contract, status, and runtime file locations.',
		parameters: harness_read_params_schema,
		async execute(_tool_call_id, params: HarnessReadParams) {
			return tool_text(format_harness_summary(params.harness_dir));
		},
	});

	pi.on('session_start', async (_event, ctx) => {
		active_harness_dir = restore_active_harness(ctx);
		update_harness_ui(ctx, active_harness_dir);
	});

	pi.on('before_agent_start', async (event) => {
		let system_prompt = event.systemPrompt;
		if (should_inject_harness_prompt(event)) {
			system_prompt = `${system_prompt}\n\n${HARNESS_SYSTEM_PROMPT}`;
		}
		if (
			active_harness_dir &&
			existsSync(harness_paths(active_harness_dir).contract)
		) {
			system_prompt = `${system_prompt}\n\n${active_harness_context(active_harness_dir)}`;
		}
		return { systemPrompt: system_prompt };
	});

	pi.on('tool_call', async (event) => {
		if (
			!active_harness_dir ||
			!existsSync(harness_paths(active_harness_dir).contract)
		) {
			return;
		}
		const contract = read_contract(active_harness_dir);
		if (event.toolName === 'bash') {
			const input = event.input as { command?: string };
			const command = input.command ?? '';
			const result = check_command_allowed(contract, command);
			if (!result.ok) return { block: true, reason: result.reason };
		}
		if (event.toolName === 'edit' || event.toolName === 'write') {
			const input = event.input as { path?: string };
			if (!input.path) return;
			const result = check_path_allowed(contract, input.path);
			if (!result.ok) return { block: true, reason: result.reason };
		}
	});

	pi.on('session_shutdown', async (_event, ctx) => {
		ctx.ui.setStatus('harness', undefined);
		ctx.ui.setWidget('harness', undefined);
	});
}
