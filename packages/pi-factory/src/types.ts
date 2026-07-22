import type { HarnessContract } from '@spences10/pi-harness';

export type FactoryLifecycle =
	| 'succeeded'
	| 'failed'
	| 'cancelled'
	| 'timed-out'
	| 'lost';
export type FactoryCompletion =
	| 'validated'
	| 'failed'
	| 'refused'
	| 'interrupted';

export interface FactoryContract {
	task: string;
	cwd: string;
	harness_dir: string;
	validation_commands: string[];
	constraints?: string[];
	timeout_ms?: number;
	executor_model?: string;
	reviewer_model?: string;
	baseline_changed_files: string[];
	runtime_contract: HarnessContract;
}

export interface ProcessResult {
	lifecycle: FactoryLifecycle;
	exit_code: number | null;
	stdout: string;
	stderr: string;
	identity?: {
		provider?: string;
		model?: string;
		session_id?: string;
	};
	cleanup?: { complete: boolean; residuals: string[] };
}

export interface ValidationEvidence {
	command: string;
	ok: boolean;
	exit_code: number | null;
	output: string;
	lifecycle: 'settled' | 'cancelled' | 'timed-out' | 'lost';
	revision_digest?: string;
	cleanup?: { complete: boolean; residuals: string[] };
}

export interface ReviewResult {
	verdict: 'approve' | 'changes-requested' | 'refuse';
	findings: string[];
	raw: string;
}

export interface FactoryReport {
	run_id?: string;
	report_artifact?: string;
	completion: FactoryCompletion;
	lifecycle: FactoryLifecycle;
	changed_files: string[];
	usage_identity: {
		provider?: string;
		model?: string;
		session_id?: string;
	};
	reviewer_identity?: {
		provider?: string;
		model?: string;
		session_id?: string;
	};
	validation: ValidationEvidence[];
	review?: ReviewResult;
	executor_output: string;
	cleanup: { complete: boolean; residuals: string[] };
	error?: string;
}

export interface ProcessRequest {
	role: 'executor' | 'reviewer';
	cwd: string;
	prompt: string;
	model?: string;
	harness_dir: string;
	harness_contract: HarnessContract;
	timeout_ms: number;
	signal?: AbortSignal;
}

export type ProcessRunner = (
	request: ProcessRequest,
) => Promise<ProcessResult>;
export type CommandRunner = (
	command: string,
	cwd: string,
	signal?: AbortSignal,
	timeout_ms?: number,
) => Promise<ValidationEvidence>;
