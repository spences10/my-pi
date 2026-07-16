import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
	add_evidence,
	complete_node,
	create_review_packet,
	fail_node,
	normalize_feedback,
	record_initial_review,
	start_node,
} from './engine.js';
import {
	run_validation_node,
	type FactoryExecutionAdapters,
} from './runner.js';
import { scope_matches } from './scope.js';
import type {
	FactoryState,
	FeedbackPacket,
	NodeState,
	ReviewerFinding,
	ReviewPacket,
	RolePolicy,
	TaskContract,
} from './types.js';

export type ExecutionAdapterMode =
	| 'sdk-owned'
	| 'rpc-owned'
	| 'peer-mailbox-only'
	| 'operator-required';
export type ExecutionLifecycle =
	| 'intent'
	| 'starting'
	| 'running'
	| 'settled'
	| 'succeeded'
	| 'failed'
	| 'cancelled'
	| 'lost'
	| 'operator-required';
export interface ExecutionAdapterCapabilities {
	mode: ExecutionAdapterMode;
	initiate: boolean;
	poll: boolean;
	cancel: boolean;
	pause: boolean;
	resume: boolean;
	recover: boolean;
	supervises_process: boolean;
}
export interface WorkspaceSnapshot {
	head: string;
	files: Record<string, string>;
}
export interface ExecutionRequest {
	execution_id: string;
	idempotency_key: string;
	workflow_id: string;
	contract_version: number;
	node_id: string;
	attempt: number;
	owner_session_id: string;
	read_only: boolean;
	task: string;
	contract: TaskContract;
	role_policy: RolePolicy;
	cwd: string;
	allowed_paths: string[];
	artifact_ids: string[];
	workspace_baseline?: WorkspaceSnapshot;
	review_packet?: ReviewPacket;
	review_diff?: string;
}
export interface ExecutionAcceptanceResult {
	criterion: string;
	status: 'met' | 'unmet';
	evidence_ids: string[];
}
export interface ExecutionResult {
	execution_id: string;
	lifecycle: ExecutionLifecycle;
	protocol_version?: 1;
	contract_version?: number;
	outcome?:
		| 'completed'
		| 'incomplete'
		| 'refused'
		| 'escalated'
		| 'failed';
	changed_files?: string[];
	acceptance_results?: ExecutionAcceptanceResult[];
	adapter_id: string;
	adapter_version: string;
	started_at?: string;
	finished_at?: string;
	artifact_ids?: string[];
	evidence?: Array<{
		id?: string;
		kind: string;
		summary: string;
		uri?: string;
	}>;
	telemetry_run_id?: string;
	observability_session_id?: string;
	tokens?: number;
	cost_usd?: number;
	effective_policy?: RolePolicy;
	review?: {
		review_id: string;
		verdict: 'approve' | 'changes-requested' | 'escalate';
		findings: ReviewerFinding[];
		current_diff: string;
	};
	failure?: {
		category:
			| 'provider'
			| 'timeout'
			| 'process-death'
			| 'cancelled'
			| 'unsupported'
			| 'implementation';
		message: string;
	};
}
export interface WorkflowExecutionAdapter {
	id: string;
	version: string;
	capabilities: ExecutionAdapterCapabilities;
	initiate(request: ExecutionRequest): Promise<ExecutionResult>;
	poll?(execution_id: string): Promise<ExecutionResult>;
	cancel?(execution_id: string): Promise<ExecutionResult>;
	pause?(execution_id: string): Promise<ExecutionResult>;
	resume?(execution_id: string): Promise<ExecutionResult>;
	recover?(request: ExecutionRequest): Promise<ExecutionResult>;
}
export interface ExecutionRecord {
	request: ExecutionRequest;
	adapter_id: string;
	adapter_version: string;
	lifecycle: ExecutionLifecycle;
	created_at: string;
	updated_at: string;
	result?: ExecutionResult;
}
interface ExecutionFile {
	schema_version: 1;
	records: Record<string, ExecutionRecord>;
}

export class ExecutionRegistry {
	readonly path: string;
	constructor(path: string) {
		this.path = resolve(path);
	}
	private load(): ExecutionFile {
		if (!existsSync(this.path))
			return { schema_version: 1, records: {} };
		const file = JSON.parse(
			readFileSync(this.path, 'utf8'),
		) as ExecutionFile;
		if (file.schema_version !== 1 || !file.records)
			throw new Error('Unsupported execution registry');
		return file;
	}
	private save(file: ExecutionFile): void {
		mkdirSync(dirname(this.path), { recursive: true });
		const temporary = `${this.path}.${randomUUID()}.tmp`;
		writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`, {
			flag: 'wx',
			mode: 0o600,
		});
		renameSync(temporary, this.path);
	}
	private with_lock<T>(operation: () => T): T {
		mkdirSync(dirname(this.path), { recursive: true });
		const lock_path = `${this.path}.lock`;
		let lock: number;
		try {
			lock = openSync(lock_path, 'wx', 0o600);
		} catch {
			throw new Error(
				'Execution registry is being updated concurrently',
			);
		}
		try {
			return operation();
		} finally {
			closeSync(lock);
			unlinkSync(lock_path);
		}
	}
	put(record: ExecutionRecord): void {
		this.with_lock(() => {
			const file = this.load();
			file.records[record.request.execution_id] = record;
			this.save(file);
		});
	}
	reserve(record: ExecutionRecord): ExecutionRecord {
		return this.with_lock(() => {
			const file = this.load();
			const existing = Object.values(file.records).find(
				(item) =>
					item.request.idempotency_key ===
					record.request.idempotency_key,
			);
			if (existing) return existing;
			file.records[record.request.execution_id] = record;
			this.save(file);
			return record;
		});
	}
	get(execution_id: string): ExecutionRecord | undefined {
		return this.load().records[execution_id];
	}
	find_by_key(key: string): ExecutionRecord | undefined {
		return Object.values(this.load().records).find(
			(record) => record.request.idempotency_key === key,
		);
	}
	list_pending(): ExecutionRecord[] {
		return Object.values(this.load().records).filter((record) =>
			['intent', 'starting', 'running'].includes(record.lifecycle),
		);
	}
	mark_terminal(
		execution_id: string,
		lifecycle: 'failed' | 'cancelled' | 'lost',
		category: NonNullable<ExecutionResult['failure']>['category'],
		message: string,
	): ExecutionRecord {
		const record = this.get(execution_id);
		if (!record) throw new Error(`Unknown execution ${execution_id}`);
		const timestamp = new Date().toISOString();
		record.lifecycle = lifecycle;
		record.updated_at = timestamp;
		record.result = {
			execution_id,
			lifecycle,
			adapter_id: record.adapter_id,
			adapter_version: record.adapter_version,
			finished_at: timestamp,
			failure: { category, message },
		};
		this.put(record);
		return record;
	}
	mark_lost(execution_id: string, message: string): ExecutionRecord {
		return this.mark_terminal(
			execution_id,
			'lost',
			'process-death',
			message,
		);
	}
}

function node_for(state: FactoryState, node_id: string): NodeState {
	const node = state.nodes.find((item) => item.id === node_id);
	if (!node) throw new Error(`Unknown node ${node_id}`);
	return node;
}
function idempotency_key(
	state: FactoryState,
	node: NodeState,
): string {
	return `${state.workflow_id}:${state.contract_version}:${node.id}:${node.attempts + 1}`;
}
function path_is_allowed(
	cwd: string,
	path: string,
	allowed_paths: string[],
): boolean {
	return allowed_paths.some((allowed) =>
		scope_matches(cwd, path, allowed),
	);
}
function changed_since(
	baseline: WorkspaceSnapshot,
	current: WorkspaceSnapshot,
): string[] {
	if (baseline.head !== current.head)
		throw new Error('Workspace HEAD changed during owned execution');
	return [
		...new Set([
			...Object.keys(baseline.files),
			...Object.keys(current.files),
		]),
	]
		.filter((path) => baseline.files[path] !== current.files[path])
		.sort();
}
function structured_result_error(
	state: FactoryState,
	node: NodeState,
	result: ExecutionResult | undefined,
): string | undefined {
	if (!result || result.protocol_version !== 1)
		return 'Execution settled without structured result protocol version 1';
	if (result.contract_version !== state.contract_version)
		return 'Execution result contract version is stale';
	if (!result.outcome) return 'Execution result omitted its outcome';
	if (!Array.isArray(result.changed_files))
		return 'Execution result omitted changed_files';
	if (
		!Array.isArray(result.evidence) ||
		result.evidence.some(
			(item) =>
				!item ||
				typeof item.kind !== 'string' ||
				typeof item.summary !== 'string' ||
				(item.id !== undefined && typeof item.id !== 'string'),
		)
	)
		return 'Execution result omitted or malformed evidence';
	if (
		!Array.isArray(result.acceptance_results) ||
		result.acceptance_results.some(
			(item) =>
				!item ||
				typeof item.criterion !== 'string' ||
				!['met', 'unmet'].includes(item.status) ||
				!Array.isArray(item.evidence_ids) ||
				item.evidence_ids.some((id) => typeof id !== 'string'),
		)
	)
		return 'Execution result omitted or malformed acceptance_results';
	const authoritative = state.contract.acceptance_criteria;
	if (
		result.acceptance_results.length !== authoritative.length ||
		result.acceptance_results.some(
			(item, index) => item.criterion !== authoritative[index],
		)
	)
		return 'Execution result replaced or reordered authoritative acceptance criteria';
	if (
		result.changed_files.some(
			(path) =>
				typeof path !== 'string' ||
				!path_is_allowed(
					state.route.workspace.cwd,
					path,
					state.route.harness.allowed_paths,
				),
		)
	)
		return 'Execution result claimed changed files outside the authoritative path scope';
	if (
		['refused', 'escalated', 'failed'].includes(result.outcome) &&
		(!result.failure ||
			![
				'provider',
				'timeout',
				'process-death',
				'cancelled',
				'unsupported',
				'implementation',
			].includes(result.failure.category) ||
			typeof result.failure.message !== 'string')
	)
		return `${result.outcome} execution omitted failure classification`;
	if (result.outcome === 'completed') {
		if (result.evidence.length === 0)
			return 'Completed execution requires structured evidence';
		const supplied_evidence_ids = result.evidence.flatMap((item) =>
			item.id ? [item.id] : [],
		);
		const result_evidence_ids = new Set(supplied_evidence_ids);
		if (result_evidence_ids.size !== supplied_evidence_ids.length)
			return 'Completed execution supplied duplicate evidence ids';
		if (
			result.acceptance_results.some((item) =>
				item.evidence_ids.some((id) => !result_evidence_ids.has(id)),
			)
		)
			return 'Completed execution referenced unknown acceptance evidence';
		if (
			node.kind === 'execute' &&
			result.acceptance_results.some(
				(item) =>
					item.status !== 'met' || item.evidence_ids.length === 0,
			)
		)
			return 'Completed execution has unmet or unsupported acceptance criteria';
		if (node.kind === 'execute' && result.changed_files.length === 0)
			return 'Completed execution claimed no changed files';
	}
	return undefined;
}
export class ExecutionController {
	constructor(
		readonly registry: ExecutionRegistry,
		readonly capture_workspace?: (
			state: FactoryState,
		) => WorkspaceSnapshot,
	) {}
	async initiate_hypotheses(
		state: FactoryState,
		node_id: string,
		adapter: WorkflowExecutionAdapter,
		options: { owner_session_id: string; cwd: string },
		count: number,
	): Promise<ExecutionRecord[]> {
		const node = node_for(state, node_id);
		if (node.kind !== 'plan' || node.status !== 'ready')
			throw new Error(
				'Parallel hypotheses require a ready planner node',
			);
		if (!adapter.capabilities.initiate)
			throw new Error(
				'Parallel hypotheses require an initiating owned adapter',
			);
		if (!this.capture_workspace)
			throw new Error(
				'Parallel hypotheses require controller workspace capture before launch',
			);
		const bounded = Math.max(
			0,
			Math.min(count, state.route.workflow.compute.parallelism),
		);
		const records = Array.from({ length: bounded }, (_, index) => {
			const request: ExecutionRequest = {
				execution_id: randomUUID(),
				idempotency_key: `${idempotency_key(state, node)}:hypothesis:${index + 1}`,
				workflow_id: state.workflow_id,
				contract_version: state.contract_version,
				node_id,
				attempt: node.attempts + 1,
				owner_session_id: options.owner_session_id,
				read_only: true,
				task: state.contract.task,
				contract: structuredClone(state.contract),
				role_policy: structuredClone(
					state.route.workflow.compute.planner,
				),
				cwd: resolve(options.cwd),
				allowed_paths: [],
				artifact_ids: [...state.authoritative.artifact_ids],
				workspace_baseline: this.capture_workspace?.(state),
			};
			const timestamp = new Date().toISOString();
			return this.registry.reserve({
				request,
				adapter_id: adapter.id,
				adapter_version: adapter.version,
				lifecycle: 'intent',
				created_at: timestamp,
				updated_at: timestamp,
			});
		});
		return Promise.all(
			records.map(async (record) => {
				if (record.lifecycle !== 'intent') return record;
				record.lifecycle = 'starting';
				record.updated_at = new Date().toISOString();
				this.registry.put(record);
				try {
					return this.record_result(
						record,
						await adapter.initiate(record.request),
					);
				} catch (error) {
					return this.record_result(record, {
						execution_id: record.request.execution_id,
						lifecycle: 'failed',
						adapter_id: adapter.id,
						adapter_version: adapter.version,
						failure: {
							category: 'provider',
							message:
								error instanceof Error
									? error.message
									: String(error),
						},
					});
				}
			}),
		);
	}
	async initiate(
		state: FactoryState,
		node_id: string,
		adapter: WorkflowExecutionAdapter,
		options: {
			owner_session_id: string;
			task?: string;
			cwd: string;
			read_only?: boolean;
			review_diff?: string;
		},
	): Promise<ExecutionRecord> {
		const node = node_for(state, node_id);
		if (state.contract.status !== 'authoritative')
			throw new Error(
				'Legacy workflow has no authoritative task contract; amend it before execution',
			);
		// A legacy caller may still provide task, but it cannot override the
		// authoritative contract embedded in every request.
		void options.task;
		if (
			node.kind === 'approval' ||
			node.kind === 'complete' ||
			node.kind === 'validate'
		)
			throw new Error(
				`Node ${node.kind} requires its authoritative factory operation`,
			);
		const active_attempt = this.registry
			.list_pending()
			.find(
				(record) =>
					record.request.workflow_id === state.workflow_id &&
					record.request.contract_version ===
						state.contract_version &&
					record.request.node_id === node_id,
			);
		if (active_attempt)
			throw new Error(
				`Active owned attempt already exists for ${state.workflow_id}/${node_id}: ${active_attempt.request.execution_id}`,
			);
		if (node.status !== 'ready')
			throw new Error(`Node ${node_id} is not ready`);
		if (state.status !== 'created' && state.status !== 'running')
			throw new Error(
				`Workflow ${state.workflow_id} cannot initiate execution while ${state.status}`,
			);
		if (!adapter.capabilities.initiate)
			return this.operator_required(state, node, adapter, options);
		const key = idempotency_key(state, node);
		if (!options.read_only) {
			const other_owner = state.claims.find(
				(claim) =>
					claim.status === 'active' &&
					claim.owner_session_id !== options.owner_session_id,
			);
			if (other_owner)
				throw new Error(
					'A different mutating owner holds the active path claim',
				);
			const owner_claim = state.claims.find(
				(claim) =>
					claim.status === 'active' &&
					claim.owner_session_id === options.owner_session_id,
			);
			if (!owner_claim)
				throw new Error(
					'Mutating execution requires an active path claim for its owner',
				);
		}
		const request: ExecutionRequest = {
			execution_id: randomUUID(),
			idempotency_key: key,
			workflow_id: state.workflow_id,
			contract_version: state.contract_version,
			node_id,
			attempt: node.attempts + 1,
			owner_session_id: options.owner_session_id,
			read_only: options.read_only ?? false,
			task: state.contract.task,
			contract: structuredClone(state.contract),
			role_policy: structuredClone(
				state.route.workflow.compute[
					node.kind === 'plan'
						? 'planner'
						: node.kind === 'review'
							? 'reviewer'
							: 'executor'
				],
			),
			cwd: resolve(options.cwd),
			allowed_paths: state.route.harness.allowed_paths,
			artifact_ids: [...state.authoritative.artifact_ids],
			workspace_baseline:
				node.kind === 'execute'
					? this.capture_workspace?.(state)
					: undefined,
			review_packet:
				node.kind === 'review'
					? structuredClone(
							[...state.reviews]
								.reverse()
								.find(
									(review) =>
										review.contract_version ===
										state.contract_version,
								)!,
						)
					: undefined,
			review_diff:
				node.kind === 'review' ? options.review_diff : undefined,
		};
		if (node.kind === 'review' && !request.review_packet)
			throw new Error(
				'Review execution requires a current independent review packet',
			);
		const now = new Date().toISOString();
		const record: ExecutionRecord = {
			request,
			adapter_id: adapter.id,
			adapter_version: adapter.version,
			lifecycle: 'intent',
			created_at: now,
			updated_at: now,
		};
		const reserved = this.registry.reserve(record);
		if (reserved.request.execution_id !== record.request.execution_id)
			return reserved;
		start_node(state, node_id, options.owner_session_id);
		try {
			record.lifecycle = 'starting';
			record.updated_at = new Date().toISOString();
			this.registry.put(record);
			const result = await adapter.initiate(request);
			return this.record_result(record, result);
		} catch (error) {
			return this.record_result(record, {
				execution_id: request.execution_id,
				lifecycle: 'failed',
				adapter_id: adapter.id,
				adapter_version: adapter.version,
				failure: {
					category: 'provider',
					message:
						error instanceof Error ? error.message : String(error),
				},
			});
		}
	}
	private operator_required(
		state: FactoryState,
		node: NodeState,
		adapter: WorkflowExecutionAdapter,
		options: { owner_session_id: string; task?: string; cwd: string },
	): ExecutionRecord {
		const now = new Date().toISOString();
		const request: ExecutionRequest = {
			execution_id: randomUUID(),
			idempotency_key: idempotency_key(state, node),
			workflow_id: state.workflow_id,
			contract_version: state.contract_version,
			node_id: node.id,
			attempt: node.attempts + 1,
			owner_session_id: options.owner_session_id,
			read_only: true,
			task: state.contract.task,
			contract: structuredClone(state.contract),
			role_policy: structuredClone(
				state.route.workflow.compute[
					node.kind === 'plan'
						? 'planner'
						: node.kind === 'review'
							? 'reviewer'
							: 'executor'
				],
			),
			cwd: resolve(options.cwd),
			allowed_paths: state.route.harness.allowed_paths,
			artifact_ids: [...state.authoritative.artifact_ids],
			workspace_baseline:
				node.kind === 'execute'
					? this.capture_workspace?.(state)
					: undefined,
		};
		const record: ExecutionRecord = {
			request,
			adapter_id: adapter.id,
			adapter_version: adapter.version,
			lifecycle: 'operator-required',
			created_at: now,
			updated_at: now,
		};
		this.registry.put(record);
		return record;
	}
	private record_result(
		record: ExecutionRecord,
		result: ExecutionResult,
	): ExecutionRecord {
		if (result.execution_id !== record.request.execution_id)
			throw new Error('Adapter returned a mismatched execution id');
		record.lifecycle = result.lifecycle;
		record.result = result;
		record.updated_at = new Date().toISOString();
		this.registry.put(record);
		return record;
	}
	apply_result(
		state: FactoryState,
		record: ExecutionRecord,
	): FeedbackPacket | undefined {
		const node = node_for(state, record.request.node_id);
		if (
			record.request.workflow_id !== state.workflow_id ||
			record.request.contract_version !== state.contract_version ||
			record.request.attempt !== node.attempts
		)
			throw new Error(
				'Stale execution result cannot mutate current workflow state',
			);
		if (
			[
				'settled',
				'succeeded',
				'failed',
				'cancelled',
				'lost',
			].includes(record.lifecycle) &&
			!state.events.some(
				(item) =>
					item.type === 'execution.lifecycle' &&
					item.metadata?.execution_id === record.request.execution_id,
			)
		)
			state.events.push({
				id: randomUUID(),
				workflow_id: state.workflow_id,
				workflow_version: state.route.workflow.version,
				node_id: record.request.node_id,
				type: 'execution.lifecycle',
				timestamp: new Date().toISOString(),
				role:
					node.kind === 'plan'
						? 'planner'
						: node.kind === 'review'
							? 'reviewer'
							: 'executor',
				attempt: record.request.attempt,
				session_id: record.request.owner_session_id,
				telemetry_run_id: record.result?.telemetry_run_id,
				observability_session_id:
					record.result?.observability_session_id,
				tokens: record.result?.tokens,
				cost_usd: record.result?.cost_usd,
				metadata: {
					execution_id: record.request.execution_id,
					adapter_id: record.adapter_id,
					lifecycle: record.lifecycle,
					read_only: record.request.read_only,
				},
			});
		if (
			record.lifecycle === 'settled' ||
			record.lifecycle === 'succeeded'
		) {
			if (node.status === 'succeeded') return undefined;
			const invalid = structured_result_error(
				state,
				node,
				record.result,
			);
			if (invalid)
				return this.fail_structured_result(
					state,
					node,
					invalid,
					false,
				);
			const outcome = record.result!.outcome!;
			if (outcome !== 'completed')
				return this.fail_structured_result(
					state,
					node,
					`Execution settled with ${outcome} outcome`,
					outcome === 'escalated',
				);
			if (node.kind === 'execute') {
				if (
					!this.capture_workspace ||
					!record.request.workspace_baseline
				)
					return this.fail_structured_result(
						state,
						node,
						'Controller workspace snapshot verifier is unavailable',
						false,
					);
				const claimed = record.result!.changed_files!.map((path) =>
					resolve(state.route.workspace.cwd, path),
				);
				let observed: string[];
				try {
					observed = changed_since(
						record.request.workspace_baseline,
						this.capture_workspace(state),
					).map((path) => resolve(state.route.workspace.cwd, path));
				} catch (error) {
					return this.fail_structured_result(
						state,
						node,
						`Controller changed-file verification failed: ${error instanceof Error ? error.message : String(error)}`,
						false,
					);
				}
				if (
					observed.some(
						(path) =>
							!path_is_allowed(
								state.route.workspace.cwd,
								path,
								state.route.harness.allowed_paths,
							),
					)
				)
					return this.fail_structured_result(
						state,
						node,
						'Controller observed changes outside the authoritative path scope',
						false,
					);
				if (
					JSON.stringify([...new Set(claimed)].sort()) !==
					JSON.stringify([...new Set(observed)].sort())
				)
					return this.fail_structured_result(
						state,
						node,
						'Claimed changed files do not match the complete controller-observed workspace delta',
						false,
					);
			}
			if (node.kind === 'review') {
				const review = record.result?.review;
				if (!review)
					return this.fail_invalid_review(
						state,
						node,
						'Review adapter completed without a structured verdict',
					);
				const packet = record_initial_review(
					state,
					review.review_id,
					review.verdict,
					review.findings,
					review.current_diff,
				);
				this.persist_structured_evidence(state, node, record);
				if (packet) return packet;
			} else this.persist_structured_evidence(state, node, record);
			complete_node(state, node.id, record.result?.artifact_ids);
			return undefined;
		}
		if (!['failed', 'cancelled', 'lost'].includes(record.lifecycle))
			return undefined;
		if (!record.result?.failure)
			return this.fail_structured_result(
				state,
				node,
				`Execution ${record.lifecycle} omitted failure classification`,
				false,
			);
		const packet = normalize_feedback({
			workflow_id: state.workflow_id,
			node_id: node.id,
			attempt: node.attempts,
			source: 'reviewer',
			owner_session_id: node.owner_session_id,
			contradictory: false,
			unsafe_fix: false,
			items: [
				{
					severity: 'error',
					code: `execution.${record.result?.failure?.category ?? record.lifecycle}`,
					message:
						record.result?.failure?.message ??
						`Execution ${record.lifecycle}`,
					evidence_ids: [],
					required_action:
						'Retry with recovered ownership or escalate',
				},
			],
		});
		fail_node(state, packet);
		return packet;
	}
	private persist_structured_evidence(
		state: FactoryState,
		node: NodeState,
		record: ExecutionRecord,
	): void {
		const canonical_ids = new Map<string, string>();
		for (const evidence of record.result!.evidence!) {
			const canonical = add_evidence(state, {
				kind: evidence.kind,
				summary: evidence.summary,
				uri: evidence.uri,
				source_id: evidence.id,
			});
			if (evidence.id) canonical_ids.set(evidence.id, canonical.id);
		}
		for (const evaluation of record.result!.acceptance_results!)
			state.acceptance_evaluations.push({
				execution_id: record.request.execution_id,
				contract_version: state.contract_version,
				node_id: node.id,
				criterion: evaluation.criterion,
				status: evaluation.status,
				evidence_ids: evaluation.evidence_ids.map(
					(id) => canonical_ids.get(id)!,
				),
			});
	}
	private fail_structured_result(
		state: FactoryState,
		node: NodeState,
		message: string,
		contradictory: boolean,
	): FeedbackPacket {
		const packet = normalize_feedback({
			workflow_id: state.workflow_id,
			node_id: node.id,
			attempt: node.attempts,
			source: 'check',
			owner_session_id: node.owner_session_id,
			contradictory,
			unsafe_fix: false,
			items: [
				{
					severity: 'error',
					code: 'execution.invalid-structured-result',
					message,
					evidence_ids: [],
					required_action:
						'Return a contract-bound structured result; only the controller may transition the node',
				},
			],
		});
		fail_node(state, packet);
		return packet;
	}
	private fail_invalid_review(
		state: FactoryState,
		node: NodeState,
		message: string,
	): FeedbackPacket {
		const packet = normalize_feedback({
			workflow_id: state.workflow_id,
			node_id: node.id,
			attempt: node.attempts,
			source: 'reviewer',
			owner_session_id: node.owner_session_id,
			contradictory: false,
			unsafe_fix: false,
			items: [
				{
					severity: 'error',
					code: 'execution.invalid-review',
					message,
					evidence_ids: [],
					required_action:
						'Return a structured verdict bound to the current review packet and diff',
				},
			],
		});
		fail_node(state, packet);
		return packet;
	}
	async poll(
		record: ExecutionRecord,
		adapter: WorkflowExecutionAdapter,
	): Promise<ExecutionRecord> {
		if (!adapter.capabilities.poll || !adapter.poll) return record;
		return this.record_result(
			record,
			await adapter.poll(record.request.execution_id),
		);
	}
	async pause(
		record: ExecutionRecord,
		adapter: WorkflowExecutionAdapter,
	): Promise<ExecutionRecord> {
		if (!adapter.capabilities.pause || !adapter.pause)
			throw new Error('Execution adapter cannot pause its process');
		return this.record_result(
			record,
			await adapter.pause(record.request.execution_id),
		);
	}
	async resume(
		record: ExecutionRecord,
		adapter: WorkflowExecutionAdapter,
	): Promise<ExecutionRecord> {
		if (!adapter.capabilities.resume || !adapter.resume)
			throw new Error('Execution adapter cannot resume its process');
		return this.record_result(
			record,
			await adapter.resume(record.request.execution_id),
		);
	}
	async cancel(
		record: ExecutionRecord,
		adapter: WorkflowExecutionAdapter,
	): Promise<ExecutionRecord> {
		if (!adapter.capabilities.cancel || !adapter.cancel)
			throw new Error('Execution adapter cannot cancel its process');
		return this.record_result(
			record,
			await adapter.cancel(record.request.execution_id),
		);
	}
	async recover(
		record: ExecutionRecord,
		adapter: WorkflowExecutionAdapter,
	): Promise<ExecutionRecord> {
		if (!adapter.capabilities.recover || !adapter.recover) {
			return this.record_result(record, {
				execution_id: record.request.execution_id,
				lifecycle: 'lost',
				adapter_id: record.adapter_id,
				adapter_version: record.adapter_version,
				finished_at: new Date().toISOString(),
				failure: {
					category: 'unsupported',
					message:
						'Owned execution cannot be recovered by its adapter',
				},
			});
		}
		return this.record_result(
			record,
			await adapter.recover(record.request),
		);
	}
}

export class WorkflowOperator {
	constructor(
		readonly controller: ExecutionController,
		readonly adapters: Record<string, WorkflowExecutionAdapter>,
		readonly persist_state: (state: FactoryState) => void,
		readonly validation_adapters: FactoryExecutionAdapters = {},
	) {}
	private async route_feedback(packet: FeedbackPacket | undefined) {
		if (
			packet?.owner_session_id &&
			this.validation_adapters.route_feedback
		)
			await this.validation_adapters.route_feedback(
				packet.owner_session_id,
				packet,
			);
	}
	async progress(
		state: FactoryState,
		options: {
			owner_session_id: string;
			task?: string;
			cwd: string;
			review?: {
				acceptance_criteria?: string[];
				changed_files: string[];
				constraints?: string[];
				diff: string;
			};
		},
	): Promise<ExecutionRecord[]> {
		const progressed: ExecutionRecord[] = [];
		for (const pending of this.controller.registry.list_pending()) {
			if (pending.request.workflow_id !== state.workflow_id) continue;
			const hypothesis =
				pending.request.idempotency_key.includes(':hypothesis:');
			const pending_node = node_for(state, pending.request.node_id);
			if (
				!hypothesis &&
				pending_node.status === 'ready' &&
				pending_node.attempts + 1 === pending.request.attempt
			) {
				start_node(
					state,
					pending_node.id,
					pending.request.owner_session_id,
				);
				this.persist_state(state);
			}
			const adapter =
				this.adapters[pending.adapter_id] ??
				Object.values(this.adapters).find(
					(item) => item.id === pending.adapter_id,
				);
			if (!adapter) {
				const lost = this.controller.registry.mark_lost(
					pending.request.execution_id,
					'Execution adapter is unavailable after reload',
				);
				progressed.push(lost);
				if (!hypothesis)
					await this.route_feedback(
						this.controller.apply_result(state, lost),
					);
				this.persist_state(state);
				continue;
			}
			const refreshed = !adapter.capabilities.poll
				? await this.controller.recover(pending, adapter)
				: await this.controller.poll(pending, adapter);
			progressed.push(refreshed);
			if (hypothesis) {
				this.persist_state(state);
				continue;
			}
			if (refreshed.lifecycle === 'operator-required') {
				const node = node_for(state, refreshed.request.node_id);
				node.status = 'blocked';
				node.blocked_reason =
					'Execution ownership requires an explicit operator handoff';
				state.status = 'blocked';
				this.persist_state(state);
				continue;
			}
			if (
				[
					'settled',
					'succeeded',
					'failed',
					'cancelled',
					'lost',
				].includes(refreshed.lifecycle)
			) {
				await this.route_feedback(
					this.controller.apply_result(state, refreshed),
				);
				this.persist_state(state);
			}
		}
		if (
			this.controller.registry
				.list_pending()
				.some(
					(record) =>
						record.request.workflow_id === state.workflow_id &&
						record.request.idempotency_key.includes(':hypothesis:'),
				)
		)
			return progressed;
		for (;;) {
			const ready = state.nodes.find(
				(node) => node.status === 'ready',
			);
			if (!ready) break;
			if (ready.kind === 'validate') {
				start_node(state, ready.id, options.owner_session_id);
				this.persist_state(state);
				const disposition = await run_validation_node(
					state,
					this.validation_adapters,
				);
				this.persist_state(state);
				if (disposition !== 'passed') break;
				continue;
			}
			if (
				ready.kind !== 'plan' &&
				ready.kind !== 'execute' &&
				ready.kind !== 'review'
			)
				break;
			if (ready.kind === 'review') {
				const current_review = [...state.reviews]
					.reverse()
					.find(
						(review) =>
							review.contract_version === state.contract_version &&
							!review.initial_verdict,
					);
				if (!current_review) {
					if (!options.review) break;
					create_review_packet(
						state,
						options.review.acceptance_criteria,
						options.review.changed_files,
						options.review.constraints,
						options.review.diff,
					);
					this.persist_state(state);
				}
			}
			const adapter = this.adapters[ready.kind];
			if (!adapter) break;
			if (
				ready.kind === 'plan' &&
				state.route.workflow.compute.parallelism > 1 &&
				adapter.capabilities.initiate
			) {
				if (!this.controller.capture_workspace) {
					const packet = normalize_feedback({
						workflow_id: state.workflow_id,
						node_id: ready.id,
						attempt: ready.attempts,
						source: 'check',
						owner_session_id: options.owner_session_id,
						contradictory: false,
						unsafe_fix: true,
						items: [
							{
								severity: 'critical',
								code: 'execution.hypothesis-verifier-unavailable',
								message:
									'Read-only hypotheses require workspace capture before launch',
								evidence_ids: [],
								required_action:
									'Configure controller workspace capture before parallel diagnosis',
							},
						],
					});
					start_node(state, ready.id, options.owner_session_id);
					fail_node(state, packet);
					await this.route_feedback(packet);
					this.persist_state(state);
					return progressed;
				}
				const hypotheses = await this.controller.initiate_hypotheses(
					state,
					ready.id,
					adapter,
					{
						owner_session_id: options.owner_session_id,
						cwd: options.cwd,
					},
					state.route.workflow.compute.parallelism,
				);
				progressed.push(...hypotheses);
				for (const hypothesis of hypotheses) {
					const result = hypothesis.result;
					const baseline = hypothesis.request.workspace_baseline;
					let observed_changes: string[] | undefined;
					if (baseline && this.controller.capture_workspace)
						try {
							observed_changes = changed_since(
								baseline,
								this.controller.capture_workspace(state),
							);
						} catch (error) {
							observed_changes = [
								error instanceof Error
									? error.message
									: String(error),
							];
						}
					if (
						!baseline ||
						!this.controller.capture_workspace ||
						observed_changes?.length
					) {
						const packet = normalize_feedback({
							workflow_id: state.workflow_id,
							node_id: ready.id,
							attempt: ready.attempts,
							source: 'check',
							owner_session_id: options.owner_session_id,
							contradictory: false,
							unsafe_fix: true,
							items: [
								{
									severity: 'critical',
									code: 'execution.hypothesis-mutated-workspace',
									message:
										!baseline || !this.controller.capture_workspace
											? 'Read-only hypothesis cannot be verified because workspace capture is unavailable'
											: `Read-only hypothesis changed workspace: ${observed_changes!.join(', ')}`,
									evidence_ids: [],
									required_action:
										'Restore the workspace and resolve ownership before planning continues',
								},
							],
						});
						start_node(state, ready.id, options.owner_session_id);
						fail_node(state, packet);
						await this.route_feedback(packet);
						this.persist_state(state);
						return progressed;
					}
					if (
						[
							'settled',
							'succeeded',
							'failed',
							'cancelled',
							'lost',
						].includes(hypothesis.lifecycle) &&
						!state.events.some(
							(item) =>
								item.type === 'execution.lifecycle' &&
								item.metadata?.execution_id ===
									hypothesis.request.execution_id,
						)
					)
						state.events.push({
							id: randomUUID(),
							workflow_id: state.workflow_id,
							workflow_version: state.route.workflow.version,
							node_id: ready.id,
							type: 'execution.lifecycle',
							timestamp: new Date().toISOString(),
							role: 'planner',
							attempt: hypothesis.request.attempt,
							session_id: hypothesis.request.owner_session_id,
							telemetry_run_id: result?.telemetry_run_id,
							observability_session_id:
								result?.observability_session_id,
							tokens: result?.tokens,
							cost_usd: result?.cost_usd,
							metadata: {
								execution_id: hypothesis.request.execution_id,
								adapter_id: hypothesis.adapter_id,
								lifecycle: hypothesis.lifecycle,
								read_only: true,
							},
						});
					if (
						!['settled', 'succeeded'].includes(
							hypothesis.lifecycle,
						) ||
						result?.outcome !== 'completed' ||
						structured_result_error(state, ready, result) ||
						result.changed_files!.length
					)
						continue;
					for (const evidence of result!.evidence!) {
						if (
							evidence.id &&
							state.evidence.some(
								(item) => item.source_id === evidence.id,
							)
						)
							continue;
						const canonical = add_evidence(state, {
							kind: `hypothesis:${evidence.kind}`,
							summary: evidence.summary,
							uri: evidence.uri,
							source_id: evidence.id,
						});
						state.authoritative.artifact_ids.push(canonical.id);
					}
					for (const artifact_id of result!.artifact_ids ?? [])
						if (
							!state.authoritative.artifact_ids.includes(artifact_id)
						)
							state.authoritative.artifact_ids.push(artifact_id);
				}
				this.persist_state(state);
				if (
					hypotheses.some((item) =>
						['intent', 'starting', 'running'].includes(
							item.lifecycle,
						),
					)
				)
					return progressed;
			}
			const record = await this.controller.initiate(
				state,
				ready.id,
				adapter,
				{
					...options,
					review_diff: options.review?.diff,
				},
			);
			this.persist_state(state);
			progressed.push(record);
			if (record.lifecycle === 'operator-required') {
				ready.status = 'blocked';
				ready.blocked_reason =
					'Execution ownership requires an explicit operator handoff';
				state.status = 'blocked';
				this.persist_state(state);
				break;
			}
			if (
				![
					'settled',
					'succeeded',
					'failed',
					'cancelled',
					'lost',
				].includes(record.lifecycle)
			)
				break;
			await this.route_feedback(
				this.controller.apply_result(state, record),
			);
			this.persist_state(state);
			if (state.status === 'escalated' || state.status === 'blocked')
				break;
		}
		return progressed;
	}
	private adapter_for(record: ExecutionRecord) {
		return (
			this.adapters[record.adapter_id] ??
			Object.values(this.adapters).find(
				(item) => item.id === record.adapter_id,
			)
		);
	}
	async pause_active(state: FactoryState): Promise<void> {
		for (const record of this.controller.registry.list_pending()) {
			if (record.request.workflow_id !== state.workflow_id) continue;
			const adapter = this.adapter_for(record);
			if (!adapter)
				throw new Error('Active execution adapter is unavailable');
			await this.controller.pause(record, adapter);
		}
		state.status = 'paused';
		this.persist_state(state);
	}
	async resume_active(state: FactoryState): Promise<void> {
		for (const record of this.controller.registry.list_pending()) {
			if (record.request.workflow_id !== state.workflow_id) continue;
			const adapter = this.adapter_for(record);
			if (!adapter)
				throw new Error('Active execution adapter is unavailable');
			await this.controller.resume(record, adapter);
		}
		state.status = 'running';
		this.persist_state(state);
	}
	async timeout_active(
		state: FactoryState,
		maximum_duration_ms: number,
		now_ms = Date.now(),
	): Promise<number> {
		let timed_out = 0;
		for (const record of this.controller.registry.list_pending()) {
			if (record.request.workflow_id !== state.workflow_id) continue;
			const started = Date.parse(
				record.result?.started_at ?? record.created_at,
			);
			if (now_ms - started <= maximum_duration_ms) continue;
			const adapter = this.adapter_for(record);
			const cancelled =
				adapter?.capabilities.cancel && adapter.cancel
					? await this.controller.cancel(record, adapter)
					: this.controller.registry.mark_terminal(
							record.request.execution_id,
							'failed',
							'timeout',
							`Execution exceeded ${maximum_duration_ms}ms`,
						);
			cancelled.lifecycle = 'failed';
			cancelled.result = {
				...cancelled.result!,
				lifecycle: 'failed',
				failure: {
					category: 'timeout',
					message: `Execution exceeded ${maximum_duration_ms}ms`,
				},
			};
			this.controller.registry.put(cancelled);
			if (!record.request.idempotency_key.includes(':hypothesis:'))
				this.controller.apply_result(state, cancelled);
			timed_out += 1;
		}
		if (timed_out) this.persist_state(state);
		return timed_out;
	}
	async cancel_active(
		state: FactoryState,
		reason: string,
	): Promise<void> {
		for (const record of this.controller.registry.list_pending()) {
			if (record.request.workflow_id !== state.workflow_id) continue;
			const adapter = this.adapter_for(record);
			const cancelled =
				adapter?.capabilities.cancel && adapter.cancel
					? await this.controller.cancel(record, adapter)
					: this.controller.registry.mark_terminal(
							record.request.execution_id,
							'cancelled',
							'cancelled',
							reason,
						);
			cancelled.lifecycle = 'cancelled';
			cancelled.result = {
				...cancelled.result!,
				lifecycle: 'cancelled',
				failure: { category: 'cancelled', message: reason },
			};
			this.controller.registry.put(cancelled);
			if (!record.request.idempotency_key.includes(':hypothesis:'))
				this.controller.apply_result(state, cancelled);
			this.persist_state(state);
		}
	}
}

export function create_sdk_execution_adapter(options: {
	id?: string;
	version?: string;
	run(request: ExecutionRequest): Promise<ExecutionResult>;
	poll?(execution_id: string): Promise<ExecutionResult>;
	cancel?(execution_id: string): Promise<ExecutionResult>;
	pause?(execution_id: string): Promise<ExecutionResult>;
	resume?(execution_id: string): Promise<ExecutionResult>;
	recover?(request: ExecutionRequest): Promise<ExecutionResult>;
}): WorkflowExecutionAdapter {
	return {
		id: options.id ?? 'pi-sdk',
		version: options.version ?? '1',
		capabilities: {
			mode: 'sdk-owned',
			initiate: true,
			poll: options.poll !== undefined,
			cancel: options.cancel !== undefined,
			pause: options.pause !== undefined,
			resume: options.resume !== undefined,
			recover: options.recover !== undefined,
			supervises_process: true,
		},
		initiate: async (request) => {
			const result = await options.run(request);
			if (
				request.role_policy.enforcement === 'enforced' &&
				JSON.stringify(result.effective_policy) !==
					JSON.stringify(request.role_policy)
			)
				throw new Error(
					'SDK result did not confirm the enforced model and reasoning policy',
				);
			return result;
		},
		poll: options.poll
			? async (execution_id) => options.poll!(execution_id)
			: undefined,
		cancel: options.cancel
			? async (execution_id) => options.cancel!(execution_id)
			: undefined,
		pause: options.pause
			? async (execution_id) => options.pause!(execution_id)
			: undefined,
		resume: options.resume
			? async (execution_id) => options.resume!(execution_id)
			: undefined,
		recover: options.recover
			? async (request) => {
					const result = await options.recover!(request);
					if (
						request.role_policy.enforcement === 'enforced' &&
						JSON.stringify(result.effective_policy) !==
							JSON.stringify(request.role_policy)
					)
						throw new Error(
							'SDK recovery did not confirm the enforced model and reasoning policy',
						);
					return result;
				}
			: undefined,
	};
}
export function create_rpc_execution_adapter(options: {
	command: string;
	args?: string[];
	cwd: string;
}): WorkflowExecutionAdapter {
	type OwnedProcess = {
		child: ChildProcess;
		result: ExecutionResult;
		stdout_buffer: string;
		assistant_text: string;
		stderr: string;
	};
	const processes = new Map<string, OwnedProcess>();
	const missing = (execution_id: string): ExecutionResult => ({
		execution_id,
		lifecycle: 'lost',
		adapter_id: 'pi-rpc',
		adapter_version: '1',
		failure: {
			category: 'process-death',
			message: 'Owned RPC process is unavailable',
		},
	});
	function prompt(request: ExecutionRequest): string {
		return [
			`Operate factory workflow ${request.workflow_id} node ${request.node_id}, contract ${request.contract_version}, attempt ${request.attempt}.`,
			request.read_only
				? 'This execution is read-only.'
				: 'You are the single mutating owner for this execution.',
			`Authoritative contract: ${JSON.stringify(request.contract)}`,
			`Effective role policy: ${JSON.stringify(request.role_policy)}`,
			`Task: ${request.contract.task}`,
			`Workspace: ${request.cwd}`,
			`Allowed paths: ${JSON.stringify(request.allowed_paths)}`,
			`Authoritative artifacts: ${JSON.stringify(request.artifact_ids)}`,
			request.review_packet
				? `Independently review this packet before consuming any executor narrative: ${JSON.stringify(request.review_packet)}\nAuthoritative diff:\n${request.review_diff ?? ''}`
				: 'Complete only this node and do not commit, push, deploy, release, grant approval, or call factory control-plane actions.',
			`Return exactly one JSON object using protocol_version 1, contract_version ${request.contract_version}, outcome (completed|incomplete|refused|escalated|failed), changed_files, evidence entries with stable ids, and acceptance_results containing every authoritative criterion verbatim with status and evidence_ids.${request.review_packet ? ' Also include review_id, verdict, findings, and current_diff with the exact authoritative diff.' : ''}`,
		].join('\n');
	}
	function structured_result(
		text: string,
	): Pick<
		ExecutionResult,
		| 'protocol_version'
		| 'contract_version'
		| 'outcome'
		| 'changed_files'
		| 'evidence'
		| 'acceptance_results'
		| 'failure'
	> {
		try {
			const parsed = JSON.parse(text.trim()) as Record<
				string,
				unknown
			>;
			return {
				protocol_version:
					parsed.protocol_version === 1 ? 1 : undefined,
				contract_version:
					typeof parsed.contract_version === 'number'
						? parsed.contract_version
						: undefined,
				outcome: [
					'completed',
					'incomplete',
					'refused',
					'escalated',
					'failed',
				].includes(String(parsed.outcome))
					? (parsed.outcome as ExecutionResult['outcome'])
					: undefined,
				changed_files: Array.isArray(parsed.changed_files)
					? (parsed.changed_files as string[])
					: undefined,
				evidence: Array.isArray(parsed.evidence)
					? (parsed.evidence as NonNullable<
							ExecutionResult['evidence']
						>)
					: undefined,
				acceptance_results: Array.isArray(parsed.acceptance_results)
					? (parsed.acceptance_results as ExecutionAcceptanceResult[])
					: undefined,
				failure:
					parsed.failure && typeof parsed.failure === 'object'
						? (parsed.failure as ExecutionResult['failure'])
						: undefined,
			};
		} catch {
			return {};
		}
	}
	function review_result(
		request: ExecutionRequest,
		text: string,
	): ExecutionResult['review'] | undefined {
		if (!request.review_packet) return undefined;
		try {
			const parsed = JSON.parse(text.trim()) as Record<
				string,
				unknown
			>;
			if (
				parsed.review_id !== request.review_packet.id ||
				!['approve', 'changes-requested', 'escalate'].includes(
					String(parsed.verdict),
				) ||
				!Array.isArray(parsed.findings) ||
				typeof parsed.current_diff !== 'string'
			)
				return undefined;
			return {
				review_id: parsed.review_id,
				verdict: parsed.verdict as
					| 'approve'
					| 'changes-requested'
					| 'escalate',
				findings: parsed.findings as ReviewerFinding[],
				current_diff: parsed.current_diff,
			};
		} catch {
			return undefined;
		}
	}
	return {
		id: 'pi-rpc',
		version: '1',
		capabilities: {
			mode: 'rpc-owned',
			initiate: true,
			poll: true,
			cancel: true,
			pause: true,
			resume: true,
			recover: false,
			supervises_process: true,
		},
		async initiate(request) {
			const configured_args = [...(options.args ?? [])];
			const args = request.read_only
				? configured_args.filter((argument, index) => {
						if (
							argument === '--tools' ||
							argument === '-t' ||
							argument.startsWith('--tools=')
						)
							return false;
						const previous = configured_args[index - 1];
						return previous !== '--tools' && previous !== '-t';
					})
				: configured_args;
			if (request.read_only)
				args.push('--tools', 'read,grep,find,ls');
			if (request.role_policy.enforcement === 'enforced') {
				if (!request.role_policy.model)
					throw new Error(
						'Enforced role policy requires an explicit model',
					);
				args.push(
					'--model',
					request.role_policy.model,
					'--thinking',
					request.role_policy.thinking,
				);
			}
			const child = spawn(options.command, args, {
				cwd: resolve(options.cwd),
				shell: false,
				stdio: ['pipe', 'pipe', 'pipe'],
				env: {
					...process.env,
					PI_FACTORY_EXECUTION_ID: request.execution_id,
					PI_FACTORY_WORKFLOW_ID: request.workflow_id,
					PI_FACTORY_NODE_ID: request.node_id,
					PI_FACTORY_CHILD_ROLE: request.review_packet
						? 'reviewer'
						: request.node_id === 'plan'
							? 'planner'
							: 'executor',
					PI_FACTORY_CONTROL_PLANE: 'read-only',
				},
			});
			await new Promise<void>((resolve_spawn, reject_spawn) => {
				child.once('spawn', resolve_spawn);
				child.once('error', reject_spawn);
			});
			const owned: OwnedProcess = {
				child,
				result: {
					execution_id: request.execution_id,
					lifecycle: 'running',
					adapter_id: 'pi-rpc',
					adapter_version: '1',
					effective_policy: structuredClone(request.role_policy),
					started_at: new Date().toISOString(),
				},
				stdout_buffer: '',
				assistant_text: '',
				stderr: '',
			};
			processes.set(request.execution_id, owned);
			child.stderr?.on('data', (chunk: Buffer | string) => {
				owned.stderr = `${owned.stderr}${String(chunk)}`.slice(
					-16_384,
				);
			});
			child.stdout?.on('data', (chunk: Buffer | string) => {
				owned.stdout_buffer += String(chunk);
				if (owned.stdout_buffer.length > 1_048_576)
					owned.stdout_buffer = owned.stdout_buffer.slice(-1_048_576);
				for (;;) {
					const newline = owned.stdout_buffer.indexOf('\n');
					if (newline < 0) break;
					const line = owned.stdout_buffer
						.slice(0, newline)
						.replace(/\r$/, '');
					owned.stdout_buffer = owned.stdout_buffer.slice(
						newline + 1,
					);
					if (!line) continue;
					let event: Record<string, unknown>;
					try {
						event = JSON.parse(line) as Record<string, unknown>;
					} catch {
						owned.result = {
							...owned.result,
							lifecycle: 'failed',
							finished_at: new Date().toISOString(),
							failure: {
								category: 'provider',
								message: 'Pi RPC emitted invalid JSONL',
							},
						};
						child.kill('SIGTERM');
						break;
					}
					if (
						event.type === 'response' &&
						event.id === request.execution_id &&
						event.success === false
					) {
						owned.result = {
							...owned.result,
							lifecycle: 'failed',
							finished_at: new Date().toISOString(),
							failure: {
								category: 'provider',
								message:
									typeof event.error === 'string'
										? event.error
										: JSON.stringify(
												event.error ?? 'Pi RPC rejected prompt',
											),
							},
						};
						child.kill('SIGTERM');
					}
					const update = event.assistantMessageEvent as
						| Record<string, unknown>
						| undefined;
					if (
						update?.type === 'text_delta' &&
						typeof update.delta === 'string'
					)
						owned.assistant_text += update.delta;
					if (event.type === 'agent_settled') {
						owned.result = {
							...owned.result,
							...structured_result(owned.assistant_text),
							lifecycle: 'settled',
							finished_at: new Date().toISOString(),
							review: review_result(request, owned.assistant_text),
						};
						child.kill('SIGTERM');
					}
				}
			});
			child.once('exit', (code) => {
				if (owned.result.lifecycle !== 'running') return;
				owned.result = {
					...owned.result,
					lifecycle: 'failed',
					finished_at: new Date().toISOString(),
					failure: {
						category: 'process-death',
						message: `Pi RPC process exited ${code ?? 'without status'} before agent_settled${owned.stderr ? `: ${owned.stderr}` : ''}`,
					},
				};
			});
			child.stdin?.write(
				`${JSON.stringify({
					id: request.execution_id,
					type: 'prompt',
					message: prompt(request),
				})}\n`,
			);
			return structuredClone(owned.result);
		},
		async poll(execution_id) {
			return structuredClone(
				processes.get(execution_id)?.result ?? missing(execution_id),
			);
		},
		async pause(execution_id) {
			const owned = processes.get(execution_id);
			if (
				!owned ||
				owned.child.exitCode !== null ||
				!owned.child.kill('SIGSTOP')
			)
				throw new Error('Owned RPC process is unavailable');
			return structuredClone(owned.result);
		},
		async resume(execution_id) {
			const owned = processes.get(execution_id);
			if (
				!owned ||
				owned.child.exitCode !== null ||
				!owned.child.kill('SIGCONT')
			)
				throw new Error('Owned RPC process is unavailable');
			return structuredClone(owned.result);
		},
		async cancel(execution_id) {
			const owned = processes.get(execution_id);
			if (!owned) return missing(execution_id);
			if (owned.child.exitCode === null) owned.child.kill('SIGTERM');
			owned.result = {
				...owned.result,
				lifecycle: 'cancelled',
				finished_at: new Date().toISOString(),
				failure: {
					category: 'cancelled',
					message: 'RPC process cancellation requested',
				},
			};
			return structuredClone(owned.result);
		},
	};
}
export const peer_execution_adapter: WorkflowExecutionAdapter = {
	id: 'team-peer',
	version: '1',
	capabilities: {
		mode: 'peer-mailbox-only',
		initiate: false,
		poll: false,
		cancel: false,
		pause: false,
		resume: false,
		recover: false,
		supervises_process: false,
	},
	async initiate(request) {
		return {
			execution_id: request.execution_id,
			lifecycle: 'operator-required',
			adapter_id: 'team-peer',
			adapter_version: '1',
		};
	},
};
