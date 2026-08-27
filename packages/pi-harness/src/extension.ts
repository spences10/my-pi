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
	assessment_tool_names,
	check_assessment_command,
	create_assessment_state,
	format_assessment_record,
	harness_assess_params_schema,
	harness_assessment_submit_params_schema,
	is_assessment_tool_allowed,
	submit_assessment_record,
	type HarnessAssessmentRecommendation,
	type HarnessAssessmentSource,
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
} from './runtime/files.js';
import {
	active_harness_context,
	amend_harness_runtime,
	create_harness_runtime,
	format_harness_status_line,
	format_harness_summary,
	update_harness_runtime,
} from './runtime/index.js';
import {
	HARNESS_CUSTOM_TYPE,
	harness_amend_params_schema,
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

function restore_assessment(
	ctx: ExtensionContext,
): HarnessAssessmentState | undefined {
	const entries = ctx.sessionManager.getBranch() as Array<{
		type?: string;
		customType?: string;
		data?: HarnessAssessmentState;
	}>;
	return entries
		.filter(
			(entry) =>
				entry.type === 'custom' &&
				entry.customType === HARNESS_ASSESSMENT_CUSTOM_TYPE,
		)
		.pop()?.data;
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
	ctx.ui.setStatus(
		'harness',
		format_harness_status_line(harness_dir),
	);
	ctx.ui.setWidget('harness', undefined);
}

function update_assessment_ui(
	ctx: ExtensionContext,
	state: HarnessAssessmentState | undefined,
): void {
	if (!state || !assessment_active(state)) {
		ctx.ui.setStatus('harness-assessment', undefined);
		return;
	}
	const label =
		state.status === 'awaiting_approval'
			? '🔎 assess: approval'
			: '🔎 assess';
	ctx.ui.setStatus('harness-assessment', label);
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

function is_terminal_harness(
	harness_dir: string | undefined,
): boolean {
	if (
		!harness_dir ||
		!existsSync(harness_paths(harness_dir).status)
	) {
		return false;
	}
	const status = read_status(harness_dir).status;
	return status === 'completed' || status === 'failed';
}

export default async function harness(pi: ExtensionAPI) {
	let active_harness_dir: string | undefined;
	let assessment_state: HarnessAssessmentState | undefined;
	let decision_prompt_open = false;

	function set_active_harness(
		harness_dir: string | undefined,
		ctx: ExtensionContext,
	): void {
		active_harness_dir = harness_dir;
		persist_active_harness(pi, harness_dir);
		update_harness_ui(ctx, harness_dir);
	}

	function persist_assessment(
		state: HarnessAssessmentState,
		ctx: ExtensionContext,
	): void {
		assessment_state = state;
		pi.appendEntry(HARNESS_ASSESSMENT_CUSTOM_TYPE, state);
		update_assessment_ui(ctx, state);
	}

	function start_assessment(
		task: string,
		source: HarnessAssessmentSource,
		ctx: ExtensionContext,
	): HarnessAssessmentState {
		const normalized_task = task.trim();
		if (
			assessment_active(assessment_state) &&
			assessment_state?.task === normalized_task
		) {
			return assessment_state;
		}
		const tools_before_assessment = assessment_active(
			assessment_state,
		)
			? assessment_state?.tools_before_assessment
			: pi.getActiveTools();
		const state = create_assessment_state(
			normalized_task,
			source,
			tools_before_assessment ?? pi.getActiveTools(),
		);
		persist_assessment(state, ctx);
		pi.setActiveTools(
			assessment_tool_names(state.tools_before_assessment),
		);
		return state;
	}

	function restore_tools_after_assessment(
		state: HarnessAssessmentState,
	): void {
		pi.setActiveTools(state.tools_before_assessment);
	}

	function complete_assessment(
		decision: HarnessAssessmentRecommendation,
		ctx: ExtensionContext,
	): { message: string; trigger: boolean } | undefined {
		const current = assessment_state;
		const record = current?.record;
		if (
			!current ||
			current.status !== 'awaiting_approval' ||
			!record
		) {
			ctx.ui.notify('No assessment is awaiting approval', 'warning');
			return;
		}

		if (
			decision === 'direct' &&
			active_harness_dir &&
			!is_terminal_harness(active_harness_dir)
		) {
			ctx.ui.notify(
				'Direct work cannot bypass the active harness; submit an approved harness contract to amend it',
				'warning',
			);
			return;
		}

		if (decision === 'harness') {
			if (!record.proposed_contract) {
				ctx.ui.notify(
					'This assessment has no proposed harness contract',
					'warning',
				);
				return;
			}
			const approved: HarnessAssessmentState = {
				...current,
				status: 'approved',
				decision,
			};
			if (
				active_harness_dir &&
				!is_terminal_harness(active_harness_dir)
			) {
				if (
					record.proposed_contract.cwd ||
					record.proposed_contract.forbidden_paths?.length ||
					record.proposed_contract.forbidden_commands?.length
				) {
					ctx.ui.notify(
						'Outer-policy changes require a separate harness contract',
						'warning',
					);
					return;
				}
				const contract = amend_harness_runtime({
					harness_dir: active_harness_dir,
					reason: `Approved assessment ${approved.id} v${approved.version}`,
					requested_by: 'user',
					task: record.proposed_contract.task,
					allowed_paths: record.proposed_contract.allowed_paths,
					validation_commands:
						record.proposed_contract.validation_commands,
					allow_test_changes:
						record.proposed_contract.allow_test_changes,
					escalation_rules: record.proposed_contract.escalation_rules,
					planner_model: record.proposed_contract.planner_model,
					planner_thinking: record.proposed_contract.planner_thinking,
					executor_model: record.proposed_contract.executor_model,
					executor_thinking:
						record.proposed_contract.executor_thinking,
					reviewer_model: record.proposed_contract.reviewer_model,
					reviewer_thinking:
						record.proposed_contract.reviewer_thinking,
				});
				persist_assessment(approved, ctx);
				restore_tools_after_assessment(approved);
				set_active_harness(active_harness_dir, ctx);
				return {
					message: `The user approved assessment ${approved.id} v${approved.version}. Resume harness ${contract.id} with approved scaffold v${contract.scaffold.version}.`,
					trigger: true,
				};
			}
			persist_assessment(approved, ctx);
			restore_tools_after_assessment(approved);
			const { harness_dir, contract } = create_harness_runtime(
				record.proposed_contract,
				ctx.cwd,
			);
			set_active_harness(harness_dir, ctx);
			return {
				message: `The user approved assessment ${approved.id} v${approved.version}. Execute harness ${contract.id} from ${harness_dir}.`,
				trigger: true,
			};
		}

		const completed: HarnessAssessmentState = {
			...current,
			status: decision === 'reject' ? 'rejected' : 'approved',
			decision,
		};
		persist_assessment(completed, ctx);
		restore_tools_after_assessment(completed);
		if (decision === 'direct') {
			return {
				message: `The user approved direct work from assessment ${completed.id} v${completed.version}. Proceed only with the smallest vertical slice recorded in the assessment.`,
				trigger: true,
			};
		}
		return {
			message: `The user rejected assessment ${completed.id} v${completed.version}. Do not implement the candidate work.`,
			trigger: false,
		};
	}

	function send_decision_message(result: {
		message: string;
		trigger: boolean;
	}): void {
		pi.sendMessage(
			{
				customType: 'harness-assessment-decision',
				content: result.message,
				display: true,
			},
			{
				triggerTurn: result.trigger,
				deliverAs: 'followUp',
			},
		);
	}

	async function prompt_for_assessment_decision(
		ctx: ExtensionContext,
	): Promise<void> {
		const current = assessment_state;
		if (
			decision_prompt_open ||
			current?.status !== 'awaiting_approval' ||
			!current.record ||
			!ctx.hasUI
		) {
			return;
		}
		decision_prompt_open = true;
		try {
			const harness_is_active =
				active_harness_dir &&
				!is_terminal_harness(active_harness_dir);
			const options = [
				...(current.record.proposed_contract
					? [
							harness_is_active
								? 'Approve and amend active harness'
								: 'Create and execute harness',
						]
					: []),
				...(harness_is_active ? [] : ['Proceed with direct work']),
				'Reject the proposed work',
				'Keep assessing',
			];
			const choice = await ctx.ui.select(
				`Assessment ${current.id} v${current.version}`,
				options,
			);
			if (
				assessment_state?.id !== current.id ||
				assessment_state.version !== current.version
			) {
				return;
			}
			const decision =
				choice?.startsWith('Create') || choice?.startsWith('Approve')
					? 'harness'
					: choice?.startsWith('Proceed')
						? 'direct'
						: choice?.startsWith('Reject')
							? 'reject'
							: undefined;
			if (!decision) return;
			const result = complete_assessment(decision, ctx);
			if (result) send_decision_message(result);
		} finally {
			decision_prompt_open = false;
		}
	}

	pi.registerCommand('assess', {
		description:
			'Assess candidate work before choosing direct execution, a harness, or rejection',
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			if (!trimmed || trimmed === 'status') {
				if (!assessment_state) {
					ctx.ui.notify('No harness assessment', 'warning');
					return;
				}
				ctx.ui.notify(
					format_assessment_record(assessment_state),
					'info',
				);
				return;
			}
			if (trimmed === 'approve' || trimmed.startsWith('approve ')) {
				const requested = trimmed.slice('approve'.length).trim();
				if (requested === 'harness' || requested === 'direct') {
					const result = complete_assessment(requested, ctx);
					if (result) send_decision_message(result);
					return;
				}
				await prompt_for_assessment_decision(ctx);
				return;
			}
			if (trimmed === 'reject') {
				const result = complete_assessment('reject', ctx);
				if (result) send_decision_message(result);
				return;
			}
			if (trimmed === 'clear') {
				if (assessment_state && assessment_active(assessment_state)) {
					restore_tools_after_assessment(assessment_state);
				}
				assessment_state = undefined;
				pi.appendEntry(HARNESS_ASSESSMENT_CUSTOM_TYPE, undefined);
				update_assessment_ui(ctx, undefined);
				ctx.ui.notify('Cleared harness assessment', 'info');
				return;
			}
			const state = start_assessment(trimmed, 'user', ctx);
			pi.sendUserMessage(
				`Assess this candidate work without modifying the repository. Use repository evidence and existing primitives before recommending direct work, a harness, or rejection.\n\n${state.task}`,
			);
		},
	});

	pi.registerCommand('harness', {
		description:
			'Assess, run, review, and inspect ephemeral /tmp task harnesses',
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
				if (!rest) {
					ctx.ui.notify('Usage: /harness create <task>', 'warning');
					return;
				}
				const state = start_assessment(rest, 'harness-create', ctx);
				pi.sendUserMessage(
					`Assess this task before creating a harness. Do not treat candidate capabilities as implementation commitments.\n\n${state.task}`,
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
					`Use the execute-harness skill to run this harness until validation completes: ${harness_dir}. If the team tool is available, create or reuse a team and create a task for this harness. Use one mutating teammate only when useful; use a worktree only when isolation and merge ownership are explicit. Then inspect team status/results before reporting.`,
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
		name: 'harness_assess',
		label: 'Start Harness Assessment',
		description:
			'Enter read-only assessment before deciding whether candidate work should run directly, use a harness, or be rejected.',
		promptSnippet:
			'Enter read-only evidence-gated assessment before adopting broad or risky work',
		promptGuidelines: [
			'Call harness_assess before repository mutation when a task may need an enforceable harness contract.',
			'Call harness_assess by itself; after it activates, use only the remaining read-only tools.',
		],
		parameters: harness_assess_params_schema,
		async execute(_tool_call_id, params, _signal, _on_update, ctx) {
			const state = start_assessment(params.task, 'agent', ctx);
			return tool_text(assessment_context(state));
		},
	});

	pi.registerTool({
		name: 'harness_assessment_submit',
		label: 'Submit Harness Assessment',
		description:
			'Submit repository evidence and one recommendation for direct work, a harness contract, or rejection. Direct user approval is still required.',
		parameters: harness_assessment_submit_params_schema,
		async execute(_tool_call_id, params, _signal, _on_update, ctx) {
			if (
				params.proposed_contract?.cwd &&
				resolve(params.proposed_contract.cwd) !== resolve(ctx.cwd)
			) {
				throw new Error(
					'Proposed harness cwd must match the assessed project',
				);
			}
			const current =
				assessment_state ??
				start_assessment(params.task, 'agent', ctx);
			const submitted = submit_assessment_record(current, params);
			persist_assessment(submitted, ctx);
			return tool_text(
				`${format_assessment_record(submitted)}\n\nWaiting for direct user approval.`,
			);
		},
	});

	pi.registerTool({
		name: 'harness_create',
		label: 'Create Harness',
		description:
			'Request an ephemeral /tmp task harness. An approved assessment is required before creation.',
		promptSnippet:
			'Request constrained execution only after evidence-gated assessment and direct user approval',
		promptGuidelines: [
			'Use harness_assess before harness_create. An unapproved harness_create call is blocked and starts assessment.',
			'Use the normal direct workflow for bounded, low-risk changes covered by standard validation.',
		],
		parameters: harness_create_params_schema,
		async execute(_tool_call_id, params, _signal, _on_update, ctx) {
			const state = start_assessment(
				params.task,
				'harness-create',
				ctx,
			);
			return tool_text(
				`Harness not created. Complete and obtain approval for assessment ${state.id}.`,
			);
		},
	});

	pi.registerTool({
		name: 'harness_amend',
		label: 'Amend Harness Scaffold',
		description:
			'Amend the active execution scaffold with an audited version change. Cannot weaken the outer runtime policy.',
		promptSnippet:
			'Amend bounded task scope, validation, test policy, or model strategy when evidence changes',
		promptGuidelines: [
			'Use harness_amend for bounded changes to the inner scaffold.',
			'New capabilities, architecture decisions, or outer-policy expansion require assessment instead of a silent amendment.',
		],
		parameters: harness_amend_params_schema,
		async execute(_tool_call_id, params, _signal, _on_update, ctx) {
			const contract = amend_harness_runtime(params);
			set_active_harness(params.harness_dir, ctx);
			return tool_text(
				`Amended harness ${contract.id} scaffold to v${contract.scaffold.version}`,
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
		assessment_state = restore_assessment(ctx);
		if (is_terminal_harness(active_harness_dir)) {
			set_active_harness(undefined, ctx);
		}
		if (assessment_active(assessment_state)) {
			pi.setActiveTools(assessment_tool_names(pi.getActiveTools()));
		}
		update_harness_ui(ctx, active_harness_dir);
		update_assessment_ui(ctx, assessment_state);
	});

	pi.on('input', async (event, ctx) => {
		if (
			event.source !== 'extension' &&
			is_terminal_harness(active_harness_dir)
		) {
			set_active_harness(undefined, ctx);
		}
	});

	pi.on('before_agent_start', async (event) => {
		let system_prompt = event.systemPrompt;
		if (should_inject_harness_prompt(event)) {
			system_prompt = `${system_prompt}\n\n${HARNESS_SYSTEM_PROMPT}`;
		}
		const current_assessment = assessment_state;
		if (current_assessment && assessment_active(current_assessment)) {
			system_prompt = `${system_prompt}\n\n${assessment_context(current_assessment)}`;
		}
		if (
			active_harness_dir &&
			existsSync(harness_paths(active_harness_dir).contract)
		) {
			system_prompt = `${system_prompt}\n\n${active_harness_context(active_harness_dir)}`;
		}
		return { systemPrompt: system_prompt };
	});

	pi.on('tool_call', async (event, ctx) => {
		if (event.toolName === 'harness_create') {
			const input = event.input as { task?: string };
			const task =
				input.task?.trim() || 'Unspecified harness request';
			const state = start_assessment(task, 'harness-create', ctx);
			return {
				block: true,
				reason: `Harness creation requires direct approval of an assessment. Assessment ${state.id} is active; investigate and call harness_assessment_submit.`,
			};
		}

		const current_assessment = assessment_state;
		if (current_assessment && assessment_active(current_assessment)) {
			if (!is_assessment_tool_allowed(event.toolName)) {
				return {
					block: true,
					reason: `Assessment ${current_assessment.id}: tool ${event.toolName} is not read-only and is disabled until the user decides.`,
				};
			}
			if (event.toolName === 'bash') {
				const input = event.input as { command?: string };
				const result = check_assessment_command(input.command ?? '');
				if (!result.ok) {
					return { block: true, reason: result.reason };
				}
			}
		}

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

	pi.on('agent_end', async (_event, ctx) => {
		await prompt_for_assessment_decision(ctx);
	});

	pi.on('session_shutdown', async (_event, ctx) => {
		ctx.ui.setStatus('harness', undefined);
		ctx.ui.setStatus('harness-assessment', undefined);
		ctx.ui.setWidget('harness', undefined);
	});
}
