import type {
	BeforeAgentStartEvent,
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	HARNESS_ASSESSMENT_CUSTOM_TYPE,
	assessment_active,
	assessment_context,
	create_assessment_state,
	format_assessment_record,
	harness_assess_params_schema,
	harness_assessment_submit_params_schema,
	submit_assessment_record,
	type HarnessAssessmentState,
} from './assessment.js';
import {
	check_command_allowed,
	check_path_allowed,
} from './enforcement/policy.js';
import { HARNESS_SYSTEM_PROMPT } from './prompt.js';
import {
	harness_paths,
	read_contract,
	read_status,
	shell_quote,
} from './runtime/files.js';
import {
	active_harness_context,
	amend_harness_runtime,
	create_harness_runtime,
	format_harness_status_line,
	format_harness_summary,
	update_harness_runtime,
} from './runtime/index.js';
import { resolve_harness_cwd } from './runtime/verification.js';
import {
	HARNESS_CUSTOM_TYPE,
	harness_amend_params_schema,
	harness_create_params_schema,
	harness_read_params_schema,
	harness_update_params_schema,
} from './schema.js';

const tool_text = (text: string) => ({
	content: [{ type: 'text' as const, text }],
	details: {},
});

export function should_inject_harness_prompt(
	event: Pick<BeforeAgentStartEvent, 'systemPromptOptions'>,
): boolean {
	const selected = event.systemPromptOptions?.selectedTools;
	return !selected || selected.includes('bash');
}

export default function harness(pi: ExtensionAPI) {
	let active_harness_dir: string | undefined;
	let assessment: HarnessAssessmentState | undefined;

	function update_ui(ctx: ExtensionContext) {
		ctx.ui.setStatus(
			'harness',
			active_harness_dir &&
				existsSync(harness_paths(active_harness_dir).status)
				? format_harness_status_line(active_harness_dir)
				: undefined,
		);
		ctx.ui.setStatus(
			'harness-assessment',
			assessment_active(assessment) ? '🔎 assess' : undefined,
		);
	}
	function set_active(
		dir: string | undefined,
		ctx: ExtensionContext,
	) {
		active_harness_dir = dir;
		pi.appendEntry(HARNESS_CUSTOM_TYPE, { active_harness_dir: dir });
		update_ui(ctx);
	}
	function start_assessment(task: string, ctx: ExtensionContext) {
		assessment = create_assessment_state(task, 'user');
		pi.appendEntry(HARNESS_ASSESSMENT_CUSTOM_TYPE, assessment);
		update_ui(ctx);
		return assessment;
	}
	function require_active(dir: string) {
		if (
			!active_harness_dir ||
			resolve(dir) !== resolve(active_harness_dir)
		)
			throw new Error(
				'Use /harness use <dir> to select this harness first',
			);
	}
	function restore(ctx: ExtensionContext) {
		active_harness_dir = undefined;
		assessment = undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== 'custom') continue;
			if (entry.customType === HARNESS_CUSTOM_TYPE)
				active_harness_dir = (
					entry.data as { active_harness_dir?: string } | undefined
				)?.active_harness_dir;
			if (entry.customType === HARNESS_ASSESSMENT_CUSTOM_TYPE)
				assessment = entry.data as HarnessAssessmentState | undefined;
		}
		if (
			active_harness_dir &&
			existsSync(harness_paths(active_harness_dir).status) &&
			read_status(active_harness_dir).status === 'completed'
		)
			set_active(undefined, ctx);
		update_ui(ctx);
	}

	pi.registerCommand('assess', {
		description:
			'Optional investigation and recommendation; does not lock tools or create an approval gate',
		handler: async (args, ctx) => {
			const task = args.trim();
			if (!task || task === 'status') {
				ctx.ui.notify(
					assessment
						? format_assessment_record(assessment)
						: 'No assessment',
					'info',
				);
			} else if (task === 'clear') {
				assessment = undefined;
				pi.appendEntry(HARNESS_ASSESSMENT_CUSTOM_TYPE, undefined);
				update_ui(ctx);
			} else if (/^(approve|reject)(?:\s|$)/.test(task)) {
				ctx.ui.notify(
					'Assessment is advisory. No approval roundtrip is required; use /harness create when useful.',
					'info',
				);
			} else {
				pi.sendUserMessage(
					assessment_context(start_assessment(task, ctx)),
				);
			}
		},
	});
	pi.registerCommand('harness', {
		description:
			'Create, run, review, or inspect an optional task harness',
		handler: async (args, ctx) => {
			const [command = 'status', ...words] = args.trim().split(/\s+/);
			const rest = words.join(' ');
			if (command === 'clear') {
				set_active(undefined, ctx);
				return;
			}
			if (command === 'create') {
				if (!rest) {
					ctx.ui.notify('Usage: /harness create <task>', 'warning');
					return;
				}
				set_active(undefined, ctx);
				pi.sendUserMessage(
					`Create a task harness with harness_create for: ${rest}. Use the project's normal acceptance checks and a suitable scope. No assessment or extra approval roundtrip is required. Do not expand the user-authorized task.`,
				);
				return;
			}
			const dir = rest || active_harness_dir;
			if (!dir) {
				ctx.ui.notify(
					'No active harness. Use /harness create <task>.',
					'info',
				);
				return;
			}
			if (
				command === 'use' ||
				command === 'run' ||
				command === 'review'
			) {
				if (!existsSync(harness_paths(dir).contract))
					throw new Error('Harness contract does not exist');
				set_active(dir, ctx);
				if (command !== 'use')
					pi.sendUserMessage(
						`Use the ${command === 'review' ? 'review' : 'execute'}-harness skill for ${dir}. Work directly unless the user has authorized peer collaboration; Team Mode only coordinates existing sessions.`,
					);
			} else if (command === 'status')
				ctx.ui.notify(format_harness_summary(dir), 'info');
			else
				ctx.ui.notify(
					'Usage: /harness create|run|review|status|use|clear',
					'info',
				);
		},
	});
	pi.registerTool({
		name: 'harness_assess',
		label: 'Assess Task',
		description:
			'Optional advisory investigation. Does not restrict tools or require another approval.',
		parameters: harness_assess_params_schema,
		executionMode: 'sequential',
		async execute(_id, params, _signal, _update, ctx) {
			return tool_text(
				assessment_context(start_assessment(params.task, ctx)),
			);
		},
	});
	pi.registerTool({
		name: 'harness_assessment_submit',
		label: 'Record Assessment',
		description:
			'Record an optional recommendation; does not create or approve a harness.',
		parameters: harness_assessment_submit_params_schema,
		executionMode: 'sequential',
		async execute(_id, params, _signal, _update, ctx) {
			assessment = submit_assessment_record(
				assessment ?? create_assessment_state(params.task, 'agent'),
				params,
			);
			pi.appendEntry(HARNESS_ASSESSMENT_CUSTOM_TYPE, assessment);
			update_ui(ctx);
			return tool_text(format_assessment_record(assessment));
		},
	});
	pi.registerTool({
		name: 'harness_create',
		label: 'Create Harness',
		description:
			'Create a task contract with accepted validation commands and optional scope. Assessment is not required.',
		parameters: harness_create_params_schema,
		executionMode: 'sequential',
		async execute(_id, params, _signal, _update, ctx) {
			if (active_harness_dir)
				throw new Error(
					'A harness is already active; the user can /harness clear or /harness create a new task',
				);
			if (params.cwd && resolve(params.cwd) !== resolve(ctx.cwd))
				throw new Error('Harness cwd must match the current project');
			const { harness_dir } = create_harness_runtime(params, ctx.cwd);
			if (assessment_active(assessment)) {
				assessment = undefined;
				pi.appendEntry(HARNESS_ASSESSMENT_CUSTOM_TYPE, undefined);
			}
			set_active(harness_dir, ctx);
			return tool_text(format_harness_summary(harness_dir));
		},
	});
	pi.registerTool({
		name: 'harness_amend',
		label: 'Amend Strategy',
		description:
			'Adjust the execution plan without removing accepted checks or expanding the accepted maximum scope.',
		parameters: harness_amend_params_schema,
		executionMode: 'sequential',
		async execute(_id, params, _signal, _update, ctx) {
			require_active(params.harness_dir);
			amend_harness_runtime({ ...params, requested_by: 'planner' });
			update_ui(ctx);
			return tool_text(format_harness_summary(params.harness_dir));
		},
	});
	pi.registerTool({
		name: 'harness_update',
		label: 'Update Harness',
		description:
			'Record progress. Requesting completed runs accepted checks and the drift guard through normal tool hooks before recording success.',
		parameters: harness_update_params_schema,
		executionMode: 'sequential',
		async execute(_id, params, signal, _update, ctx) {
			require_active(params.harness_dir);
			try {
				const status = await update_harness_runtime(params, {
					cwd: ctx.cwd,
					signal,
					run: async (command, cwd, run_signal) => {
						const outcome = await ctx.executeTool(
							'bash',
							{ command: `cd -- ${shell_quote(cwd)} && ${command}` },
							{ signal: run_signal },
						);
						return {
							passed: outcome.isError === false,
							output: JSON.stringify(outcome.result),
						};
					},
				});
				return tool_text(
					`Harness ${status.status}. Evidence: ${harness_paths(params.harness_dir).outcome_markdown}`,
				);
			} finally {
				update_ui(ctx);
			}
		},
	});
	pi.registerTool({
		name: 'harness_read',
		label: 'Read Harness',
		description:
			'Read the current task contract and outcome locations.',
		parameters: harness_read_params_schema,
		async execute(_id, params) {
			return tool_text(format_harness_summary(params.harness_dir));
		},
	});

	pi.on('session_start', async (_event, ctx) => restore(ctx));
	pi.on('session_tree', async (_event, ctx) => restore(ctx));
	pi.on('input', async (event, ctx) => {
		if (
			event.source !== 'extension' &&
			active_harness_dir &&
			existsSync(harness_paths(active_harness_dir).status) &&
			['completed', 'failed'].includes(
				read_status(active_harness_dir).status,
			)
		)
			set_active(undefined, ctx);
	});
	pi.on('before_agent_start', async (event) => {
		const contexts = [
			should_inject_harness_prompt(event)
				? HARNESS_SYSTEM_PROMPT
				: '',
			assessment_active(assessment) && assessment
				? assessment_context(assessment)
				: '',
			active_harness_dir &&
			existsSync(harness_paths(active_harness_dir).contract)
				? active_harness_context(active_harness_dir)
				: '',
		].filter(Boolean);
		return contexts.length
			? {
					systemPrompt: `${event.systemPrompt}\n\n${contexts.join('\n\n')}`,
				}
			: undefined;
	});
	pi.on('tool_call', async (event, ctx) => {
		if (
			!active_harness_dir ||
			!existsSync(harness_paths(active_harness_dir).contract)
		)
			return;
		const contract = read_contract(active_harness_dir);
		if (event.toolName === 'bash') {
			const result = check_command_allowed(
				contract,
				String((event.input as { command?: string }).command ?? ''),
			);
			if (!result.ok) return { block: true, reason: result.reason };
		}
		if (event.toolName === 'write' || event.toolName === 'edit') {
			const input = event.input as Record<string, unknown>;
			const path = input.path ?? input.file_path ?? input.filePath;
			if (typeof path !== 'string')
				return {
					block: true,
					reason: 'Harness mutation requires a known file path',
				};
			let cwd: string;
			try {
				cwd = resolve_harness_cwd(contract, ctx.cwd);
			} catch (error) {
				return { block: true, reason: String(error) };
			}
			const result = check_path_allowed(
				{ ...contract, policy: { ...contract.policy, cwd } },
				path,
			);
			if (!result.ok) return { block: true, reason: result.reason };
		}
	});
	pi.on('session_shutdown', async (_event, ctx) => {
		ctx.ui.setStatus('harness', undefined);
		ctx.ui.setStatus('harness-assessment', undefined);
	});
}
