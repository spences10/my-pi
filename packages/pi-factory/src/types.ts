export const FACTORY_SCHEMA_VERSION = 1 as const;
export type WorkflowKind =
	| 'chore'
	| 'feature'
	| 'ambiguous-bug'
	| 'ui-copy'
	| 'database-migration'
	| 'incident'
	| 'architecture'
	| 'safe-release';
export type Risk = 'low' | 'medium' | 'high' | 'critical';
export type Thinking =
	| 'off'
	| 'minimal'
	| 'low'
	| 'medium'
	| 'high'
	| 'xhigh';
export type NodeKind =
	| 'plan'
	| 'execute'
	| 'validate'
	| 'review'
	| 'approval'
	| 'complete';
export type NodeStatus =
	| 'pending'
	| 'ready'
	| 'running'
	| 'blocked'
	| 'succeeded'
	| 'failed'
	| 'escalated'
	| 'cancelled'
	| 'invalidated';
export type ReviewMode =
	| 'deterministic-only'
	| 'model-review'
	| 'adversarial-peer'
	| 'human-plus-model';
export type ApprovalAction =
	| 'commit'
	| 'push'
	| 'deploy'
	| 'release'
	| 'destructive'
	| 'public-contract';

export interface RolePolicy {
	capability:
		| 'none'
		| 'cheap'
		| 'medium'
		| 'strong'
		| 'strongest'
		| 'fast'
		| 'specialized';
	model?: string;
	thinking: Thinking;
	enforcement?: 'enforced' | 'advisory';
}
export interface ComputePolicy {
	planner: RolePolicy;
	executor: RolePolicy;
	reviewer: RolePolicy;
	parallelism: number;
	parallelism_reason: string;
}
export interface ValidationGate {
	id: string;
	execution: 'shell' | 'tool';
	command?: string;
	tool?: string;
	source:
		| 'test'
		| 'check'
		| 'lsp'
		| 'browser'
		| 'diff'
		| 'database'
		| 'release';
	required: boolean;
}
export interface WorkflowNodeDefinition {
	id: string;
	kind: NodeKind;
	depends_on: string[];
	owner_role: 'planner' | 'executor' | 'reviewer' | 'human';
	retry_limit: number;
	validation_gate_ids?: string[];
	approval_actions?: ApprovalAction[];
}
export interface WorkflowDefinition {
	schema_version: 1;
	id: WorkflowKind;
	version: string;
	description: string;
	risk: Risk;
	compute: ComputePolicy;
	review_mode: ReviewMode;
	validations: ValidationGate[];
	approvals: ApprovalAction[];
	nodes: WorkflowNodeDefinition[];
	stall_timeout_ms: number;
}
export interface RepositoryPolicy {
	schema_version: 1;
	policy_id: string;
	workflow_overrides?: Partial<
		Record<
			WorkflowKind,
			{
				validation_commands?: string[];
				retry_limit?: number;
				risk?: Risk;
				approvals?: ApprovalAction[];
			}
		>
	>;
	validations?: ValidationGate[];
	risky_paths?: string[];
	forbidden_paths?: string[];
	required_approvals?: ApprovalAction[];
	max_parallelism?: number;
	stall_timeout_ms?: number;
}
export interface TaskContract {
	version: number;
	task: string;
	acceptance_criteria: string[];
	constraints: string[];
	requested_outcome: string;
	hash: string;
	status: 'authoritative' | 'legacy-missing';
}
export interface ComplexityAssessment {
	level: 'small' | 'medium' | 'large' | 'critical';
	score: number;
	evidence: string[];
	semantic_risk: boolean;
	affected_surface: number;
}
export interface TaskIntake {
	task: string;
	cwd: string;
	acceptance_criteria?: string[];
	constraints?: string[];
	requested_outcome?: string;
	affected_paths?: string[];
	requested_side_effects?: ApprovalAction[];
	urgency?: 'normal' | 'urgent';
	hints?: Partial<{
		workflow: WorkflowKind;
		risk: Risk;
		ambiguity: boolean;
		ui: boolean;
		database: boolean;
		release: boolean;
		incident: boolean;
		architecture: boolean;
	}>;
}
export interface RouteOverride {
	workflow?: WorkflowKind;
	reason: string;
	model_overrides?: Partial<
		Record<'planner' | 'executor' | 'reviewer', string>
	>;
	parallelism?: number;
}
export interface ResolvedRoute {
	schema_version: 1;
	route_id: string;
	created_at: string;
	workspace: { cwd: string; id: string };
	work_type: WorkflowKind;
	workflow: WorkflowDefinition;
	contract: TaskContract;
	complexity: ComplexityAssessment;
	policy_id: string;
	rationale: string[];
	assumptions: string[];
	affected_paths: string[];
	requested_side_effects: ApprovalAction[];
	override?: RouteOverride;
	harness: {
		allowed_paths: string[];
		validation_commands: string[];
		tool_validations: ValidationGate[];
		allow_test_changes: boolean;
		escalation_rules: string[];
	};
	coordination: {
		owner_required: true;
		path_claims: string[];
		supervision: 'peer-evidence-only';
	};
	policy_sources: string[];
}
export interface EvidenceRef {
	id: string;
	kind: string;
	uri?: string;
	summary: string;
	hash?: string;
	source_id?: string;
	contract_version: number;
	created_at: string;
}
export interface FeedbackItem {
	severity: 'info' | 'warning' | 'error' | 'critical';
	code: string;
	message: string;
	evidence_ids: string[];
	required_action: string;
}
export interface FeedbackPacket {
	id: string;
	workflow_id: string;
	node_id: string;
	attempt: number;
	source: ValidationGate['source'] | 'reviewer';
	owner_session_id?: string;
	contradictory: boolean;
	unsafe_fix: boolean;
	items: FeedbackItem[];
	delivery: {
		status: 'pending' | 'delivered' | 'failed';
		attempts: number;
		message_id?: string;
		error?: string;
	};
	created_at: string;
}
export interface ReviewerFinding extends FeedbackItem {
	disposition: 'must-fix' | 'should-fix' | 'note';
}
export interface ReviewPacket {
	id: string;
	workflow_id: string;
	contract_version: number;
	acceptance_criteria: string[];
	changed_files: string[];
	evidence: EvidenceRef[];
	constraints: string[];
	approval_boundaries: ApprovalAction[];
	diff_hash: string;
	executor_narrative_revealed: boolean;
	initial_verdict?: {
		verdict: 'approve' | 'changes-requested' | 'escalate';
		findings: ReviewerFinding[];
		recorded_at: string;
	};
}
export interface ApprovalDecision {
	action: ApprovalAction;
	actor: string;
	decision: 'approved' | 'refused' | 'changes-requested';
	scope: string;
	evidence_ids: string[];
	contract_version: number;
	diff_hash: string;
	review_id?: string;
	authentication:
		| 'extension-ui-confirmation'
		| 'embedding-application';
	decided_at: string;
}
export interface NodeState {
	id: string;
	kind: NodeKind;
	status: NodeStatus;
	owner_session_id?: string;
	attempts: number;
	started_at?: string;
	completed_at?: string;
	blocked_reason?: string;
	input_version: number;
	artifact_ids: string[];
	feedback_ids: string[];
}
export interface PathClaim {
	workflow_id: string;
	owner_session_id: string;
	paths: string[];
	claimed_at: string;
	heartbeat_at: string;
	status: 'active' | 'released';
}
export interface FactoryEvent {
	id: string;
	workflow_id: string;
	workflow_version: string;
	node_id?: string;
	type: string;
	timestamp: string;
	role?: 'planner' | 'executor' | 'reviewer' | 'human';
	attempt?: number;
	duration_ms?: number;
	session_id?: string;
	telemetry_run_id?: string;
	observability_session_id?: string;
	tokens?: number;
	cost_usd?: number;
	metadata?: Record<string, unknown>;
}
export interface AcceptanceEvaluation {
	execution_id: string;
	contract_version: number;
	node_id: string;
	criterion: string;
	status: 'met' | 'unmet';
	evidence_ids: string[];
}
export interface FactoryState {
	schema_version: 1;
	revision: number;
	workflow_id: string;
	contract_version: number;
	contract: TaskContract;
	route: ResolvedRoute;
	harness?: { id: string; directory: string; outcome_path: string };
	status:
		| 'created'
		| 'running'
		| 'paused'
		| 'blocked'
		| 'awaiting-approval'
		| 'escalated'
		| 'completed'
		| 'cancelled';
	owner_session_id?: string;
	current_node_id?: string;
	nodes: NodeState[];
	claims: PathClaim[];
	evidence: EvidenceRef[];
	acceptance_evaluations: AcceptanceEvaluation[];
	feedback: FeedbackPacket[];
	reviews: ReviewPacket[];
	approvals: ApprovalDecision[];
	events: FactoryEvent[];
	authoritative: {
		route_version: number;
		contract_version: number;
		artifact_ids: string[];
	};
	created_at: string;
	updated_at: string;
}
export interface FactoryMetrics {
	workflow: string;
	version: string;
	runs: number;
	contracts: Array<{
		workflow_id: string;
		version: number;
		hash: string;
		task: string;
		acceptance_criteria: string[];
		constraints: string[];
		requested_outcome: string;
		status: TaskContract['status'];
	}>;
	first_pass_success_rate: number;
	validation_retries: number;
	review_retries: number;
	escalations: number;
	interruptions: number;
	substantial_rework: number;
	lead_time_ms: number;
	approval_wait_ms: number;
	tokens: number;
	cost_usd: number;
	defects: { deterministic: number; reviewer: number };
	failures: { planning: number; implementation: number };
}
