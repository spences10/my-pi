import { spawnSync } from 'node:child_process';
import {
	add_evidence,
	complete_validated_node,
	fail_node,
	normalize_feedback,
} from './engine.js';
import type {
	FactoryState,
	FeedbackPacket,
	ValidationGate,
} from './types.js';

export interface GateResult {
	success: boolean;
	summary: string;
	evidence_uri?: string;
}
export interface FactoryExecutionAdapters {
	run_tool_gate?: (
		gate: ValidationGate,
		state: FactoryState,
	) => Promise<GateResult>;
	route_feedback?: (
		owner_session_id: string,
		packet: FeedbackPacket,
	) => Promise<void>;
}
function run_shell(gate: ValidationGate, cwd: string): GateResult {
	const result = spawnSync(gate.command!, {
		cwd,
		shell: true,
		encoding: 'utf8',
		timeout: 15 * 60_000,
		maxBuffer: 1024 * 1024,
	});
	const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
		.trim()
		.slice(-16_384);
	return {
		success: result.status === 0,
		summary: output || `Exited ${result.status ?? 'without status'}`,
	};
}
export async function run_validation_node(
	state: FactoryState,
	adapters: FactoryExecutionAdapters = {},
): Promise<'passed' | 'retry' | 'escalate'> {
	const node = state.nodes.find(
		(item) =>
			item.id === state.current_node_id && item.kind === 'validate',
	);
	if (!node || node.status !== 'running')
		throw new Error('A validation node must be running');
	const definition = state.route.workflow.nodes.find(
		(item) => item.id === node.id,
	)!;
	const gate_ids = new Set(definition.validation_gate_ids ?? []);
	const gates = state.route.workflow.validations.filter(
		(gate) => gate_ids.has(gate.id) && gate.required,
	);
	let harness_shell_passed = false;
	if (
		state.harness &&
		gates.some((gate) => gate.execution === 'shell')
	) {
		const harness_result = run_shell(
			{
				id: 'harness',
				execution: 'shell',
				command: `sh ${JSON.stringify(`${state.harness.directory}/validate.sh`)}`,
				source: 'check',
				required: true,
			},
			state.route.workspace.cwd,
		);
		const evidence = add_evidence(state, {
			kind: 'validation:harness',
			uri: state.harness.outcome_path,
			summary: harness_result.summary,
		});
		if (!harness_result.success) {
			const packet = normalize_feedback({
				workflow_id: state.workflow_id,
				node_id: node.id,
				attempt: node.attempts,
				source: 'check',
				owner_session_id: node.owner_session_id,
				contradictory: false,
				unsafe_fix: false,
				items: [
					{
						severity: 'error',
						code: 'validation.harness',
						message: harness_result.summary,
						evidence_ids: [evidence.id],
						required_action:
							'Correct the harness validation failure and rerun validation',
					},
				],
			});
			const disposition = fail_node(state, packet);
			if (node.owner_session_id && adapters.route_feedback)
				await adapters.route_feedback(node.owner_session_id, packet);
			return disposition;
		}
		harness_shell_passed = true;
	}
	for (const gate of gates) {
		let result: GateResult;
		const supplied = [...state.evidence]
			.reverse()
			.find(
				(item) =>
					item.contract_version === state.contract_version &&
					item.kind === `validation:${gate.source}`,
			);
		if (gate.execution === 'shell' && harness_shell_passed)
			result = {
				success: true,
				summary: `Passed via harness ${state.harness!.id}`,
			};
		else if (gate.execution === 'shell')
			result = run_shell(gate, state.route.workspace.cwd);
		else if (adapters.run_tool_gate)
			result = await adapters.run_tool_gate(gate, state);
		else if (supplied)
			result = {
				success: true,
				summary: supplied.summary,
				evidence_uri: supplied.uri,
			};
		else
			result = {
				success: false,
				summary: `Required tool validator ${gate.tool} needs evidence from the operator or embedding adapter`,
			};
		const evidence =
			supplied ??
			add_evidence(state, {
				kind: `validation:${gate.source}`,
				uri: result.evidence_uri,
				summary: result.summary,
			});
		if (result.success)
			add_evidence(state, {
				kind: `validation-gate:${gate.id}:pass`,
				uri: evidence.uri,
				summary: `Required gate ${gate.id} passed`,
			});
		state.events.push({
			id: crypto.randomUUID(),
			workflow_id: state.workflow_id,
			workflow_version: state.route.workflow.version,
			node_id: node.id,
			type: result.success
				? 'validation.passed'
				: 'validation.failed',
			timestamp: new Date().toISOString(),
			role: 'executor',
			attempt: node.attempts,
			metadata: { gate_id: gate.id, evidence_id: evidence.id },
		});
		if (!result.success) {
			const packet = normalize_feedback({
				workflow_id: state.workflow_id,
				node_id: node.id,
				attempt: node.attempts,
				source: gate.source,
				owner_session_id: node.owner_session_id,
				contradictory: false,
				unsafe_fix: false,
				items: [
					{
						severity: 'error',
						code: `validation.${gate.id}`,
						message: result.summary,
						evidence_ids: [evidence.id],
						required_action: `Correct ${gate.id} failure and rerun only the validation node`,
					},
				],
			});
			const disposition = fail_node(state, packet);
			if (node.owner_session_id && adapters.route_feedback)
				await adapters.route_feedback(node.owner_session_id, packet);
			return disposition;
		}
	}
	complete_validated_node(state, node.id);
	return 'passed';
}
