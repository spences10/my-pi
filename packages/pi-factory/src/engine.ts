import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { createHash, randomUUID } from 'node:crypto';
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { canonical_scope, scopes_overlap } from './scope.js';
import type {
	ApprovalAction,
	ApprovalDecision,
	EvidenceRef,
	FactoryState,
	FeedbackPacket,
	NodeState,
	OwnershipTransfer,
	PathClaim,
	ResolvedRoute,
	ReviewPacket,
	ReviewerFinding,
} from './types.js';

const now = () => new Date().toISOString();
function acquire_lock(path: string): number {
	try {
		const descriptor = openSync(path, 'wx', 0o600);
		writeFileSync(descriptor, String(process.pid));
		return descriptor;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
			throw error;
		const owner = Number.parseInt(readFileSync(path, 'utf8'), 10);
		try {
			if (Number.isInteger(owner)) process.kill(owner, 0);
		} catch {
			unlinkSync(path);
			const descriptor = openSync(path, 'wx', 0o600);
			writeFileSync(descriptor, String(process.pid));
			return descriptor;
		}
		throw new Error('Factory state is busy; retry shortly');
	}
}
const workflow_id_pattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function assert_workflow_id(id: string): void {
	if (!workflow_id_pattern.test(id))
		throw new Error('Factory workflow id must be a UUID');
}
function event(
	state: FactoryState,
	type: string,
	metadata?: Record<string, unknown>,
): void {
	state.events.push({
		id: randomUUID(),
		workflow_id: state.workflow_id,
		workflow_version: state.route.workflow.version,
		node_id: state.current_node_id,
		type,
		timestamp: now(),
		metadata,
	});
}
export function create_factory_state(
	route: ResolvedRoute,
	owner_session_id?: string,
): FactoryState {
	const created_at = now();
	const nodes: NodeState[] = route.workflow.nodes.map(
		(node, index) => ({
			id: node.id,
			kind: node.kind,
			status: index === 0 ? 'ready' : 'pending',
			attempts: 0,
			input_version: 1,
			artifact_ids: [],
			feedback_ids: [],
		}),
	);
	const state: FactoryState = {
		schema_version: 1,
		revision: 0,
		workflow_id: route.route_id,
		contract_version: route.contract.version,
		contract: structuredClone(route.contract),
		route,
		status: 'created',
		owner_session_id,
		nodes,
		claims: [],
		ownership_transfers: [],
		evidence: [],
		acceptance_evaluations: [],
		feedback: [],
		reviews: [],
		approvals: [],
		events: [],
		authoritative: {
			route_version: 1,
			contract_version: route.contract.version,
			artifact_ids: [],
		},
		created_at,
		updated_at: created_at,
	};
	event(state, 'workflow.created');
	return state;
}
export function claim_paths(
	state: FactoryState,
	owner_session_id: string,
	paths: string[],
	active_claims: PathClaim[] = [],
	enforcement: 'enforced' | 'advisory' = 'enforced',
): PathClaim {
	const canonical = paths.map((path) =>
		canonical_scope(state.route.workspace.cwd, path),
	);
	const existing = state.claims.find(
		(claim) => claim.status === 'active',
	);
	if (existing) {
		if (
			existing.owner_session_id === owner_session_id &&
			JSON.stringify([...existing.paths].sort()) ===
				JSON.stringify([...canonical].sort())
		)
			return existing;
		throw new Error(
			`Workflow ${state.workflow_id} already has an authoritative owner`,
		);
	}
	const conflict = active_claims.find(
		(claim) =>
			claim.status === 'active' &&
			claim.workflow_id !== state.workflow_id &&
			claim.paths.some((claimed) =>
				canonical.some((path) => scopes_overlap('/', claimed, path)),
			),
	);
	if (conflict)
		throw new Error(
			`${conflict.enforcement === 'advisory' ? 'Blocking advisory conflict' : 'Path overlap'} with workflow ${conflict.workflow_id} owned by ${conflict.owner_session_id}`,
		);
	const claim: PathClaim = {
		workflow_id: state.workflow_id,
		owner_session_id,
		paths: canonical,
		claimed_at: now(),
		heartbeat_at: now(),
		status: 'active',
		enforcement,
	};
	state.claims.push(claim);
	state.owner_session_id = owner_session_id;
	event(state, 'ownership.claimed', {
		paths: canonical,
		enforcement,
	});
	return claim;
}
export function request_ownership_transfer(
	state: FactoryState,
	from_session_id: string,
	to_session_id: string,
): OwnershipTransfer {
	const claim = state.claims.find(
		(item) =>
			item.status === 'active' &&
			item.owner_session_id === from_session_id,
	);
	if (!claim || state.owner_session_id !== from_session_id)
		throw new Error(
			'Only the active owner may request ownership transfer',
		);
	if (
		state.ownership_transfers?.some(
			(item) => item.status === 'pending',
		)
	)
		throw new Error('An ownership transfer is already pending');
	const transfer: OwnershipTransfer = {
		id: randomUUID(),
		from_session_id,
		to_session_id,
		requested_at: now(),
		status: 'pending',
	};
	(state.ownership_transfers ??= []).push(transfer);
	event(state, 'ownership.transfer_requested', {
		transfer_id: transfer.id,
		to_session_id,
	});
	return transfer;
}

export function acknowledge_ownership_transfer(
	state: FactoryState,
	transfer_id: string,
	to_session_id: string,
): void {
	const transfer = state.ownership_transfers?.find(
		(item) => item.id === transfer_id,
	);
	if (
		!transfer ||
		transfer.status !== 'pending' ||
		transfer.to_session_id !== to_session_id
	)
		throw new Error('No matching pending ownership transfer');
	const claim = state.claims.find(
		(item) =>
			item.status === 'active' &&
			item.owner_session_id === transfer.from_session_id,
	);
	if (!claim)
		throw new Error(
			'Previous owner no longer holds the active claim',
		);
	claim.status = 'released';
	const timestamp = now();
	state.claims.push({
		...claim,
		owner_session_id: to_session_id,
		claimed_at: timestamp,
		heartbeat_at: timestamp,
		status: 'active',
	});
	state.owner_session_id = to_session_id;
	for (const node of state.nodes)
		if (
			node.owner_session_id === transfer.from_session_id &&
			node.status !== 'succeeded'
		)
			node.owner_session_id = to_session_id;
	transfer.status = 'acknowledged';
	transfer.acknowledged_at = timestamp;
	event(state, 'ownership.transferred', {
		transfer_id,
		from_session_id: transfer.from_session_id,
		to_session_id,
	});
}

export function heartbeat(
	state: FactoryState,
	owner_session_id: string,
): void {
	const claim = state.claims.find(
		(item) =>
			item.status === 'active' &&
			item.owner_session_id === owner_session_id,
	);
	if (!claim) throw new Error('No active claim for owner');
	claim.heartbeat_at = now();
	event(state, 'ownership.heartbeat');
}
export function detect_stall(
	state: FactoryState,
	at = Date.now(),
): boolean {
	const claim = state.claims.find((item) => item.status === 'active');
	if (!claim) return state.status === 'running';
	const stalled =
		at - Date.parse(claim.heartbeat_at) >
		state.route.workflow.stall_timeout_ms;
	if (stalled) {
		state.status = 'blocked';
		const node = current_node(state);
		if (node) {
			node.status = 'blocked';
			node.blocked_reason =
				'Owner heartbeat stale; Pi peer supervision is unavailable';
		}
		event(state, 'ownership.stalled');
	}
	return stalled;
}
export function current_node(
	state: FactoryState,
): NodeState | undefined {
	return (
		state.nodes.find((node) => node.id === state.current_node_id) ??
		state.nodes.find((node) => node.status === 'ready')
	);
}
function definition(state: FactoryState, id: string) {
	return state.route.workflow.nodes.find((node) => node.id === id)!;
}
function refresh_ready(state: FactoryState): void {
	for (const node of state.nodes)
		if (
			node.status === 'pending' &&
			definition(state, node.id).depends_on.every(
				(id) =>
					state.nodes.find((candidate) => candidate.id === id)
						?.status === 'succeeded',
			)
		) {
			node.status = 'ready';
			if (node.kind === 'approval') event(state, 'approval.wait');
		}
}
export function start_node(
	state: FactoryState,
	node_id: string,
	owner_session_id: string,
): NodeState {
	const node = state.nodes.find((item) => item.id === node_id);
	if (!node || node.status !== 'ready')
		throw new Error(`Node ${node_id} is not ready`);
	if (state.status !== 'created' && state.status !== 'running')
		throw new Error(
			`Workflow ${state.workflow_id} cannot start a node while ${state.status}`,
		);
	node.status = 'running';
	node.owner_session_id = owner_session_id;
	node.attempts += 1;
	node.started_at = now();
	state.current_node_id = node_id;
	state.status = 'running';
	event(state, 'node.started', { attempt: node.attempts });
	return node;
}
function latest_review(
	state: FactoryState,
): ReviewPacket | undefined {
	return [...state.reviews]
		.reverse()
		.find(
			(review) => review.contract_version === state.contract_version,
		);
}
function current_authority(state: FactoryState): {
	review_id?: string;
	diff_hash: string;
} {
	const review = latest_review(state);
	return {
		review_id: review?.id,
		diff_hash:
			review?.diff_hash ??
			createHash('sha256')
				.update(JSON.stringify(state.authoritative))
				.digest('hex'),
	};
}
export function complete_node(
	state: FactoryState,
	node_id: string,
	artifact_ids: string[] = [],
): void {
	const node = state.nodes.find((item) => item.id === node_id);
	if (!node || node.status !== 'running')
		throw new Error(`Node ${node_id} is not running`);
	if (node.kind === 'validate')
		throw new Error(
			'Validation nodes can only complete through run_validation_node',
		);
	if (
		node.kind === 'review' &&
		latest_review(state)?.initial_verdict?.verdict !== 'approve'
	)
		throw new Error(
			'Review node requires a current review packet and approving initial verdict',
		);
	if (node.kind === 'approval') {
		const required =
			definition(state, node_id).approval_actions ?? [];
		const authority = current_authority(state);
		for (const action of required)
			if (
				!state.approvals.some(
					(decision) =>
						decision.action === action &&
						decision.contract_version === state.contract_version &&
						decision.decision === 'approved' &&
						decision.review_id === authority.review_id &&
						decision.diff_hash === authority.diff_hash,
				)
			)
				throw new Error(
					`Missing explicit human approval for ${action}`,
				);
	}
	node.status = 'succeeded';
	node.completed_at = now();
	node.artifact_ids.push(...artifact_ids);
	state.authoritative.artifact_ids.push(...artifact_ids);
	event(state, 'node.succeeded');
	refresh_ready(state);
	state.current_node_id = state.nodes.find(
		(item) => item.status === 'ready',
	)?.id;
	if (
		!state.current_node_id &&
		state.nodes.every((item) => item.status === 'succeeded')
	) {
		state.status = 'completed';
		for (const claim of state.claims) claim.status = 'released';
		event(state, 'workflow.completed');
	}
}
export function complete_validated_node(
	state: FactoryState,
	node_id: string,
): void {
	const node = state.nodes.find((item) => item.id === node_id);
	if (!node || node.kind !== 'validate' || node.status !== 'running')
		throw new Error('A validation node must be running');
	const required =
		definition(state, node_id).validation_gate_ids ?? [];
	const passed = new Set(
		state.evidence
			.filter(
				(item) =>
					item.contract_version === state.contract_version &&
					item.kind.startsWith('validation-gate:') &&
					item.kind.endsWith(':pass'),
			)
			.map((item) =>
				item.kind.slice('validation-gate:'.length, -':pass'.length),
			),
	);
	const missing = required.filter((id) => !passed.has(id));
	if (missing.length)
		throw new Error(
			`Required validation gates have not passed: ${missing.join(', ')}`,
		);
	node.status = 'succeeded';
	node.completed_at = now();
	node.artifact_ids.push(
		...state.evidence
			.filter(
				(item) =>
					item.contract_version === state.contract_version &&
					item.kind.startsWith('validation-gate:'),
			)
			.map((item) => item.id),
	);
	event(state, 'node.succeeded');
	refresh_ready(state);
	state.current_node_id = state.nodes.find(
		(item) => item.status === 'ready',
	)?.id;
}
export function fail_node(
	state: FactoryState,
	packet: FeedbackPacket,
): 'retry' | 'escalate' {
	const node = state.nodes.find((item) => item.id === packet.node_id);
	if (!node || node.status !== 'running')
		throw new Error(`Node ${packet.node_id} is not running`);
	state.feedback.push(packet);
	node.feedback_ids.push(packet.id);
	event(state, 'failure.classified', {
		classification:
			node.kind === 'plan' ? 'planning' : 'implementation',
		packet_id: packet.id,
	});
	const limit = definition(state, node.id).retry_limit;
	const must_escalate =
		packet.contradictory ||
		packet.unsafe_fix ||
		!packet.owner_session_id ||
		node.attempts > limit;
	if (must_escalate) {
		node.status = 'escalated';
		state.status = 'escalated';
		node.blocked_reason = packet.contradictory
			? 'Contradictory evidence'
			: packet.unsafe_fix
				? 'Unsafe fix proposed'
				: !packet.owner_session_id
					? 'Missing owner'
					: 'Retry budget exhausted';
		event(state, 'node.escalated', { packet_id: packet.id });
		return 'escalate';
	}
	node.status = 'ready';
	state.status = 'running';
	event(state, 'node.retry_scheduled', {
		packet_id: packet.id,
		remaining: limit - node.attempts + 1,
	});
	return 'retry';
}
function safe_text(value: string, limit = 16_384): string {
	return value
		.replace(
			/(?:token|password|secret|api[_-]?key)\s*[:=]\s*\S+/gi,
			'[REDACTED]',
		)
		.slice(0, limit);
}
export function add_evidence(
	state: FactoryState,
	evidence: Omit<
		EvidenceRef,
		'id' | 'created_at' | 'contract_version'
	>,
): EvidenceRef {
	const value = {
		...evidence,
		summary: safe_text(evidence.summary),
		uri: evidence.uri?.slice(0, 2048),
		id: randomUUID(),
		contract_version: state.contract_version,
		created_at: now(),
	};
	state.evidence.push(value);
	event(state, 'evidence.recorded', {
		evidence_id: value.id,
		kind: value.kind,
	});
	return value;
}
export function create_review_packet(
	state: FactoryState,
	acceptance_criteria: string[] | undefined,
	changed_files: string[],
	constraints: string[] | undefined,
	diff: string,
): ReviewPacket {
	if (state.contract.status !== 'authoritative')
		throw new Error('Review requires an authoritative task contract');
	// Caller values are retained only for API compatibility; the stored
	// contract is the sole review authority.
	void acceptance_criteria;
	void constraints;
	const authoritative_criteria = state.contract.acceptance_criteria;
	const authoritative_constraints = state.contract.constraints;
	const validate = state.nodes.find(
		(node) => node.kind === 'validate',
	);
	if (!validate || validate.status !== 'succeeded')
		throw new Error(
			'Deterministic validation must succeed before review packet creation',
		);
	const current_evidence = state.evidence.filter(
		(item) => item.contract_version === state.contract_version,
	);
	const validate_definition = state.route.workflow.nodes.find(
		(node) => node.kind === 'validate',
	);
	const passed_gates = new Set(
		current_evidence
			.filter(
				(item) =>
					item.kind.startsWith('validation-gate:') &&
					item.kind.endsWith(':pass'),
			)
			.map((item) =>
				item.kind.slice('validation-gate:'.length, -':pass'.length),
			),
	);
	const missing_gates = (
		validate_definition?.validation_gate_ids ?? []
	).filter((id) => !passed_gates.has(id));
	if (missing_gates.length)
		throw new Error(
			`Review packet is missing required validation evidence: ${missing_gates.join(', ')}`,
		);
	if (
		!authoritative_criteria.length ||
		!changed_files.length ||
		!current_evidence.length
	)
		throw new Error(
			'Review packet requires acceptance criteria, changed files, and deterministic evidence',
		);
	const packet: ReviewPacket = {
		id: randomUUID(),
		workflow_id: state.workflow_id,
		contract_version: state.contract_version,
		acceptance_criteria: authoritative_criteria.map((item) =>
			safe_text(item, 4096),
		),
		changed_files: changed_files.map((item) => item.slice(0, 2048)),
		evidence: structuredClone(current_evidence),
		constraints: authoritative_constraints,
		approval_boundaries: state.route.workflow.approvals,
		diff_hash: createHash('sha256').update(diff).digest('hex'),
		executor_narrative_revealed: false,
	};
	state.reviews.push(packet);
	event(state, 'review.packet_created', { review_id: packet.id });
	return packet;
}
export function record_initial_review(
	state: FactoryState,
	review_id: string,
	verdict: 'approve' | 'changes-requested' | 'escalate',
	findings: ReviewerFinding[],
	current_diff: string,
): FeedbackPacket | undefined {
	const review = state.reviews.find((item) => item.id === review_id);
	if (!review || review.initial_verdict)
		throw new Error(
			'Review packet missing or initial verdict already recorded',
		);
	if (review.contract_version !== state.contract_version)
		throw new Error('Review packet contract is stale');
	if (
		review.diff_hash !==
		createHash('sha256').update(current_diff).digest('hex')
	)
		throw new Error('Review packet diff is stale');
	review.initial_verdict = { verdict, findings, recorded_at: now() };
	review.executor_narrative_revealed = true;
	event(state, 'review.initial_verdict', {
		verdict,
		finding_count: findings.length,
	});
	if (verdict === 'approve') return undefined;
	const review_node = state.nodes.find(
		(node) => node.kind === 'review',
	);
	if (!review_node || review_node.status !== 'running')
		throw new Error(
			'Review correction requires a running review node',
		);
	const executor = [...state.nodes]
		.reverse()
		.find((node) => node.kind === 'execute' && node.owner_session_id);
	const actionable = findings.filter(
		(finding) => finding.disposition === 'must-fix',
	);
	const packet = normalize_feedback({
		workflow_id: state.workflow_id,
		node_id: review_node.id,
		attempt: review_node.attempts,
		source: 'reviewer',
		owner_session_id: executor?.owner_session_id,
		contradictory: verdict === 'escalate',
		unsafe_fix: false,
		items:
			actionable.length > 0
				? actionable
				: [
						{
							severity: 'error',
							code: 'review.changes-requested',
							message: 'Reviewer requested changes',
							evidence_ids: review.evidence.map((item) => item.id),
							required_action:
								'Address reviewer findings and rerun validation and review',
						},
					],
	});
	const disposition = fail_node(state, packet);
	if (disposition === 'escalate') return packet;
	const execute_node = state.nodes.find(
		(node) => node.kind === 'execute',
	);
	const validate_node = state.nodes.find(
		(node) => node.kind === 'validate',
	);
	if (execute_node) {
		execute_node.status = 'ready';
		execute_node.completed_at = undefined;
		execute_node.feedback_ids.push(packet.id);
	}
	if (validate_node) {
		validate_node.status = 'pending';
		validate_node.completed_at = undefined;
		validate_node.artifact_ids = [];
	}
	review_node.status = 'pending';
	review_node.completed_at = undefined;
	state.current_node_id = execute_node?.id ?? validate_node?.id;
	state.evidence = state.evidence.filter(
		(item) => !item.kind.startsWith('validation'),
	);
	event(state, 'review.correction_routed', {
		packet_id: packet.id,
		owner_session_id: executor?.owner_session_id,
	});
	return packet;
}
export function record_approval(
	state: FactoryState,
	decision: Pick<
		ApprovalDecision,
		| 'action'
		| 'actor'
		| 'decision'
		| 'scope'
		| 'evidence_ids'
		| 'authentication'
	>,
): ApprovalDecision {
	if (!decision.actor.trim())
		throw new Error('Approval requires a human actor');
	const review = latest_review(state);
	if (review && review.initial_verdict?.verdict !== 'approve')
		throw new Error('Approval requires the latest review to approve');
	const authority = current_authority(state);
	const value: ApprovalDecision = {
		...decision,
		contract_version: state.contract_version,
		diff_hash: authority.diff_hash,
		review_id: authority.review_id,
		decided_at: now(),
	};
	state.approvals.push(value);
	if (decision.decision !== 'approved') {
		state.status =
			decision.decision === 'refused' ? 'cancelled' : 'blocked';
		if (decision.decision === 'refused')
			for (const claim of state.claims) claim.status = 'released';
		event(state, 'approval.denied', {
			action: decision.action,
			decision: decision.decision,
		});
	} else {
		const waiting = [...state.events]
			.reverse()
			.find((item) => item.type === 'approval.wait');
		state.events.push({
			id: randomUUID(),
			workflow_id: state.workflow_id,
			workflow_version: state.route.workflow.version,
			node_id: state.current_node_id,
			type: 'approval.granted',
			timestamp: now(),
			role: 'human',
			duration_ms: waiting
				? Math.max(0, Date.now() - Date.parse(waiting.timestamp))
				: 0,
			metadata: { action: decision.action },
		});
	}
	return value;
}
export function amend_contract(
	state: FactoryState,
	route: ResolvedRoute,
): void {
	const previous_route = state.route;
	const previous_contract_hash = state.contract.hash;
	const previous_nodes = new Map(
		state.nodes.map((node) => [node.id, node]),
	);
	state.route = route;
	state.contract_version += 1;
	state.contract = {
		...structuredClone(route.contract),
		version: state.contract_version,
	};
	state.route.contract = structuredClone(state.contract);
	state.authoritative.contract_version = state.contract_version;
	state.authoritative.route_version += 1;
	state.current_node_id = undefined;
	state.nodes = route.workflow.nodes.map((node, index) => {
		const previous = previous_nodes.get(node.id);
		const previous_definition = previous_route.workflow.nodes.find(
			(item) => item.id === node.id,
		);
		const preserve =
			node.kind === 'plan' &&
			previous?.status === 'succeeded' &&
			previous_contract_hash === route.contract.hash &&
			JSON.stringify(previous_definition) === JSON.stringify(node);
		return {
			id: node.id,
			kind: node.kind,
			status: preserve
				? 'succeeded'
				: index === 0
					? 'ready'
					: 'pending',
			owner_session_id: preserve
				? previous.owner_session_id
				: undefined,
			attempts: preserve ? previous.attempts : 0,
			started_at: preserve ? previous.started_at : undefined,
			completed_at: preserve ? previous.completed_at : undefined,
			input_version: state.contract_version,
			artifact_ids: preserve ? [...previous.artifact_ids] : [],
			feedback_ids: [],
		};
	});
	if (state.nodes[0]?.status === 'succeeded') refresh_ready(state);
	state.current_node_id = state.nodes.find(
		(node) => node.status === 'ready',
	)?.id;
	state.status = 'paused';
	event(state, 'contract.amended');
}
export function resume_state(
	state: FactoryState,
	owner_session_id: string,
): void {
	const active_claim = state.claims.find(
		(claim) => claim.status === 'active',
	);
	if (
		active_claim &&
		active_claim.owner_session_id !== owner_session_id
	)
		throw new Error(
			'Ownership transfer must be acknowledged before another session resumes',
		);
	for (const node of state.nodes)
		if (node.status === 'running' || node.status === 'blocked') {
			node.status = 'ready';
			node.owner_session_id = owner_session_id;
			node.blocked_reason = undefined;
		}
	state.owner_session_id = owner_session_id;
	state.status = 'running';
	refresh_ready(state);
	event(state, 'workflow.resumed');
}
function validate_factory_state(raw: unknown): FactoryState {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw))
		throw new Error('Invalid factory state at root');
	const state = raw as Partial<FactoryState>;
	if (state.schema_version !== 1)
		throw new Error(
			`Unsupported factory state schema version: ${String(state.schema_version)}`,
		);
	if (!state.acceptance_evaluations)
		state.acceptance_evaluations = [];
	if (!state.ownership_transfers) state.ownership_transfers = [];
	for (const claim of state.claims ?? [])
		claim.enforcement ??= 'enforced';
	if (!state.contract) {
		state.contract = {
			version: state.contract_version ?? 1,
			task: '',
			acceptance_criteria: [],
			constraints: [],
			requested_outcome: '',
			hash: '',
			status: 'legacy-missing',
		};
	}
	if (state.route && !state.route.contract)
		state.route.contract = structuredClone(state.contract);
	if (state.route && !state.route.work_type)
		state.route.work_type = state.route.workflow?.id;
	if (state.route && !state.route.complexity)
		state.route.complexity = {
			level: 'small',
			score: 0,
			evidence: ['legacy state: complexity unavailable'],
			semantic_risk: false,
			affected_surface: state.route.affected_paths?.length ?? 0,
		};
	const node_statuses = new Set([
		'pending',
		'ready',
		'running',
		'blocked',
		'succeeded',
		'failed',
		'escalated',
		'cancelled',
		'invalidated',
	]);
	const workflow_statuses = new Set([
		'created',
		'running',
		'paused',
		'blocked',
		'awaiting-approval',
		'escalated',
		'completed',
		'cancelled',
	]);
	const approval_actions = new Set([
		'commit',
		'push',
		'deploy',
		'release',
		'destructive',
		'public-contract',
	]);
	const contract_payload = {
		task: state.contract.task,
		acceptance_criteria: state.contract.acceptance_criteria,
		constraints: state.contract.constraints,
		requested_outcome: state.contract.requested_outcome,
	};
	const contract_hash = createHash('sha256')
		.update(JSON.stringify(contract_payload))
		.digest('hex');
	if (
		!Number.isInteger(state.revision) ||
		typeof state.workflow_id !== 'string' ||
		!Number.isInteger(state.contract_version) ||
		!state.contract ||
		!Number.isInteger(state.contract.version) ||
		typeof state.contract.task !== 'string' ||
		!Array.isArray(state.contract.acceptance_criteria) ||
		!Array.isArray(state.contract.constraints) ||
		typeof state.contract.requested_outcome !== 'string' ||
		typeof state.contract.hash !== 'string' ||
		!['authoritative', 'legacy-missing'].includes(
			state.contract.status,
		) ||
		state.contract.version !== state.contract_version ||
		(state.contract.status === 'authoritative' &&
			(state.contract.hash !== contract_hash ||
				JSON.stringify(state.route?.contract) !==
					JSON.stringify(state.contract))) ||
		!workflow_statuses.has(String(state.status)) ||
		!state.route?.workspace?.cwd ||
		state.route.schema_version !== 1 ||
		state.route.workflow.schema_version !== 1
	)
		throw new Error('Invalid factory state identity or route');
	if (
		!Array.isArray(state.nodes) ||
		state.nodes.some(
			(node) =>
				!node ||
				typeof node.id !== 'string' ||
				!node_statuses.has(node.status) ||
				!Number.isInteger(node.attempts) ||
				!Array.isArray(node.artifact_ids) ||
				!Array.isArray(node.feedback_ids),
		)
	)
		throw new Error('Invalid factory state nodes');
	if (
		!Array.isArray(state.claims) ||
		state.claims.some(
			(claim) =>
				!claim ||
				typeof claim.workflow_id !== 'string' ||
				typeof claim.owner_session_id !== 'string' ||
				!Array.isArray(claim.paths) ||
				!['active', 'released'].includes(claim.status),
		)
	)
		throw new Error('Invalid factory state claims');
	if (
		!Array.isArray(state.evidence) ||
		state.evidence.some(
			(item) =>
				!item ||
				typeof item.id !== 'string' ||
				typeof item.summary !== 'string' ||
				!Number.isInteger(item.contract_version),
		)
	)
		throw new Error('Invalid factory state evidence');
	if (
		!Array.isArray(state.acceptance_evaluations) ||
		state.acceptance_evaluations.some(
			(item) =>
				!item ||
				typeof item.execution_id !== 'string' ||
				!Number.isInteger(item.contract_version) ||
				typeof item.node_id !== 'string' ||
				typeof item.criterion !== 'string' ||
				!['met', 'unmet'].includes(item.status) ||
				!Array.isArray(item.evidence_ids),
		)
	)
		throw new Error('Invalid factory state acceptance evaluations');
	if (
		!Array.isArray(state.feedback) ||
		state.feedback.some(
			(packet) =>
				!packet ||
				typeof packet.id !== 'string' ||
				!Array.isArray(packet.items) ||
				!packet.delivery ||
				!['pending', 'delivered', 'failed'].includes(
					packet.delivery.status,
				),
		)
	)
		throw new Error('Invalid factory state feedback');
	if (
		!Array.isArray(state.reviews) ||
		state.reviews.some(
			(review) =>
				!review ||
				typeof review.id !== 'string' ||
				typeof review.diff_hash !== 'string' ||
				(review.initial_verdict &&
					!['approve', 'changes-requested', 'escalate'].includes(
						review.initial_verdict.verdict,
					)),
		)
	)
		throw new Error('Invalid factory state reviews');
	if (
		!Array.isArray(state.approvals) ||
		state.approvals.some(
			(decision) =>
				!decision ||
				!approval_actions.has(decision.action) ||
				!['approved', 'refused', 'changes-requested'].includes(
					decision.decision,
				) ||
				![
					'extension-ui-confirmation',
					'embedding-application',
				].includes(decision.authentication) ||
				!Number.isInteger(decision.contract_version),
		)
	)
		throw new Error('Invalid factory state approvals');
	if (
		!Array.isArray(state.events) ||
		state.events.some(
			(item) =>
				!item ||
				typeof item.id !== 'string' ||
				typeof item.type !== 'string' ||
				typeof item.timestamp !== 'string',
		)
	)
		throw new Error('Invalid factory state events');
	return state as FactoryState;
}
export class FactoryStateStore {
	constructor(readonly directory: string) {
		mkdirSync(directory, { recursive: true });
	}
	path(id: string) {
		assert_workflow_id(id);
		return join(this.directory, `${id}.json`);
	}
	save(state: FactoryState): void {
		const path = this.path(state.workflow_id);
		const lock = `${path}.lock`;
		const descriptor = acquire_lock(lock);
		try {
			if (existsSync(path)) {
				const current = JSON.parse(
					readFileSync(path, 'utf8'),
				) as FactoryState;
				if (current.revision !== state.revision)
					throw new Error(
						`Factory state conflict: expected revision ${state.revision}, found ${current.revision}`,
					);
			} else if (state.revision !== 0)
				throw new Error(
					`Factory state conflict: missing revision ${state.revision}`,
				);
			const updated_at = now();
			const next = {
				...state,
				revision: state.revision + 1,
				updated_at,
			};
			const serialized = JSON.stringify(next, null, '\t') + '\n';
			if (Buffer.byteLength(serialized) > 8 * 1024 * 1024)
				throw new Error(
					'Factory state exceeds 8 MiB persistence limit',
				);
			const temp = `${path}.${process.pid}.tmp`;
			writeFileSync(temp, serialized, { mode: 0o600 });
			renameSync(temp, path);
			state.revision = next.revision;
			state.updated_at = updated_at;
		} finally {
			closeSync(descriptor);
			unlinkSync(lock);
		}
	}
	load(id: string): FactoryState {
		return validate_factory_state(
			JSON.parse(readFileSync(this.path(id), 'utf8')) as unknown,
		);
	}
	list(): FactoryState[] {
		if (!existsSync(this.directory)) return [];
		return readdirSync(this.directory)
			.filter(
				(name) =>
					name.endsWith('.json') &&
					workflow_id_pattern.test(name.slice(0, -5)),
			)
			.map((name) => this.load(name.slice(0, -5)));
	}
	claim(
		state: FactoryState,
		owner_session_id: string,
		paths: string[],
		enforcement: 'enforced' | 'advisory' = 'enforced',
	): PathClaim {
		const lock = join(this.directory, '.claims.lock');
		const descriptor = acquire_lock(lock);
		try {
			const claim = claim_paths(
				state,
				owner_session_id,
				paths,
				this.list().flatMap((item) => item.claims),
				enforcement,
			);
			this.save(state);
			return claim;
		} finally {
			closeSync(descriptor);
			unlinkSync(lock);
		}
	}
	transfer(
		state: FactoryState,
		from_session_id: string,
		to_session_id: string,
	): OwnershipTransfer {
		const lock = join(this.directory, '.claims.lock');
		const descriptor = acquire_lock(lock);
		try {
			const transfer = request_ownership_transfer(
				state,
				from_session_id,
				to_session_id,
			);
			this.save(state);
			return transfer;
		} finally {
			closeSync(descriptor);
			unlinkSync(lock);
		}
	}
	acknowledge_transfer(
		state: FactoryState,
		transfer_id: string,
		to_session_id: string,
	): void {
		const lock = join(this.directory, '.claims.lock');
		const descriptor = acquire_lock(lock);
		try {
			acknowledge_ownership_transfer(
				state,
				transfer_id,
				to_session_id,
			);
			this.save(state);
		} finally {
			closeSync(descriptor);
			unlinkSync(lock);
		}
	}
}
export function summarize_factory_state(
	state: FactoryState,
	active_execution?: {
		execution_id: string;
		lifecycle: string;
		adapter_id: string;
		owner_session_id?: string;
		updated_at: string;
	},
) {
	const node = current_node(state);
	const claim = state.claims.find((item) => item.status === 'active');
	const blockers = state.nodes
		.filter(
			(item) =>
				item.status === 'blocked' ||
				item.status === 'failed' ||
				item.status === 'escalated',
		)
		.map(
			(item) => item.blocked_reason ?? `${item.id}: ${item.status}`,
		);
	const completed = state.nodes.filter(
		(item) => item.status === 'succeeded',
	).length;
	const next = state.nodes.find((item) => item.status === 'ready');
	return {
		workflow_id: state.workflow_id,
		task: state.contract.task,
		workflow: state.route.workflow.id,
		status: state.status,
		owner: state.owner_session_id,
		active_process_session: active_execution
			? {
					execution_id: active_execution.execution_id,
					adapter_id: active_execution.adapter_id,
					lifecycle: active_execution.lifecycle,
					owner_session_id: active_execution.owner_session_id,
				}
			: undefined,
		current_node: node?.id,
		progress: `${completed}/${state.nodes.length} nodes complete; ${state.evidence.length} evidence records`,
		last_heartbeat: claim?.heartbeat_at,
		blockers,
		next_action: blockers.length
			? 'Resolve the blocking conflict or recover execution'
			: next
				? `Run ${next.id}`
				: state.status === 'awaiting-approval'
					? 'Await explicit human approval'
					: 'Inspect workflow state',
		validation_state:
			state.nodes.find((item) => item.kind === 'validate')?.status ??
			'not-configured',
		updated_at: state.updated_at,
	};
}

export function default_factory_directory(): string {
	return join(getAgentDir(), 'factory');
}
export async function deliver_feedback_packet(
	packet: FeedbackPacket,
	sender: (packet: FeedbackPacket) => Promise<string>,
): Promise<void> {
	if (packet.delivery.status === 'delivered') return;
	packet.delivery.attempts += 1;
	try {
		const message_id = await sender(packet);
		packet.delivery = {
			status: 'delivered',
			attempts: packet.delivery.attempts,
			message_id,
		};
	} catch (error) {
		packet.delivery = {
			status: 'failed',
			attempts: packet.delivery.attempts,
			error:
				error instanceof Error
					? error.message.slice(0, 4096)
					: String(error).slice(0, 4096),
		};
	}
}
export function normalize_feedback(
	input: Omit<FeedbackPacket, 'id' | 'created_at' | 'delivery'>,
): FeedbackPacket {
	return {
		...input,
		items: input.items.slice(0, 100).map((item) => ({
			...item,
			message: safe_text(item.message),
			required_action: safe_text(item.required_action, 4096),
			evidence_ids: item.evidence_ids.slice(0, 100),
		})),
		delivery: { status: 'pending', attempts: 0 },
		id: randomUUID(),
		created_at: now(),
	};
}
export function requires_approval(
	state: FactoryState,
	action: ApprovalAction,
): boolean {
	const authority = current_authority(state);
	return (
		state.route.workflow.approvals.includes(action) &&
		!state.approvals.some(
			(item) =>
				item.action === action &&
				item.contract_version === state.contract_version &&
				item.decision === 'approved' &&
				item.review_id === authority.review_id &&
				item.diff_hash === authority.diff_hash,
		)
	);
}
