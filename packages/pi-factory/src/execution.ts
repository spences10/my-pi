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
	review_packet?: ReviewPacket;
	review_diff?: string;
}
export interface ExecutionResult {
	execution_id: string;
	lifecycle: ExecutionLifecycle;
	adapter_id: string;
	adapter_version: string;
	started_at?: string;
	finished_at?: string;
	artifact_ids?: string[];
	evidence?: Array<{ kind: string; summary: string; uri?: string }>;
	telemetry_run_id?: string;
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
export class ExecutionController {
	constructor(readonly registry: ExecutionRegistry) {}
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
		for (const evidence of record.result?.evidence ?? [])
			add_evidence(state, {
				kind: evidence.kind,
				summary: evidence.summary,
				uri: evidence.uri,
			});
		if (record.lifecycle === 'succeeded') {
			if (node.status === 'succeeded') return undefined;
			if (node.kind === 'review') {
				const review = record.result?.review;
				if (!review)
					return this.fail_invalid_review(
						state,
						node,
						'Review adapter succeeded without a structured verdict',
					);
				const packet = record_initial_review(
					state,
					review.review_id,
					review.verdict,
					review.findings,
					review.current_diff,
				);
				if (packet) return packet;
			}
			complete_node(state, node.id, record.result?.artifact_ids);
			return undefined;
		}
		if (!['failed', 'cancelled', 'lost'].includes(record.lifecycle))
			return undefined;
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
			const operator_required = {
				...record,
				lifecycle: 'operator-required' as const,
				updated_at: new Date().toISOString(),
			};
			this.registry.put(operator_required);
			return operator_required;
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
			const pending_node = node_for(state, pending.request.node_id);
			if (
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
			if (!adapter) continue;
			const refreshed = !adapter.capabilities.poll
				? await this.controller.recover(pending, adapter)
				: await this.controller.poll(pending, adapter);
			progressed.push(refreshed);
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
				['succeeded', 'failed', 'cancelled', 'lost'].includes(
					refreshed.lifecycle,
				)
			) {
				await this.route_feedback(
					this.controller.apply_result(state, refreshed),
				);
				this.persist_state(state);
			}
		}
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
				!['succeeded', 'failed', 'cancelled', 'lost'].includes(
					record.lifecycle,
				)
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
	async pause_active(state: FactoryState): Promise<void> {
		for (const record of this.controller.registry.list_pending()) {
			if (record.request.workflow_id !== state.workflow_id) continue;
			const adapter = this.adapters[record.adapter_id];
			if (!adapter) continue;
			await this.controller.pause(record, adapter);
		}
		state.status = 'paused';
		this.persist_state(state);
	}
	async resume_active(state: FactoryState): Promise<void> {
		for (const record of this.controller.registry.list_pending()) {
			if (record.request.workflow_id !== state.workflow_id) continue;
			const adapter = this.adapters[record.adapter_id];
			if (!adapter) continue;
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
			const adapter = this.adapters[record.adapter_id];
			if (!adapter) continue;
			const cancelled = await this.controller.cancel(record, adapter);
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
			const adapter = this.adapters[record.adapter_id];
			if (!adapter) continue;
			const cancelled = await this.controller.cancel(record, adapter);
			cancelled.result = {
				...cancelled.result!,
				failure: { category: 'cancelled', message: reason },
			};
			this.controller.apply_result(state, cancelled);
			this.persist_state(state);
		}
	}
}

export function create_sdk_execution_adapter(options: {
	id?: string;
	version?: string;
	run(request: ExecutionRequest): Promise<ExecutionResult>;
	recover?(request: ExecutionRequest): Promise<ExecutionResult>;
}): WorkflowExecutionAdapter {
	return {
		id: options.id ?? 'pi-sdk',
		version: options.version ?? '1',
		capabilities: {
			mode: 'sdk-owned',
			initiate: true,
			poll: false,
			cancel: false,
			pause: false,
			resume: false,
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
				? `Independently review this packet before consuming any executor narrative: ${JSON.stringify(request.review_packet)}\nAuthoritative diff:\n${request.review_diff ?? ''}\nReturn only JSON with review_id, verdict (approve|changes-requested|escalate), findings, and current_diff containing the exact authoritative diff.`
				: 'Complete only this node, provide evidence, and do not commit, push, deploy, release, or grant approval.',
		].join('\n');
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
			const args = [...(options.args ?? [])];
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
							lifecycle: 'succeeded',
							finished_at: new Date().toISOString(),
							review: review_result(request, owned.assistant_text),
							evidence: owned.assistant_text
								? [
										{
											kind: 'execution:rpc-response',
											summary: owned.assistant_text.slice(-16_384),
										},
									]
								: [],
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
