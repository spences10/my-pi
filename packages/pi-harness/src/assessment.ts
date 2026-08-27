import { Type, type Static } from 'typebox';
import { harness_create_params_schema } from './schema.js';

export const HARNESS_ASSESSMENT_CUSTOM_TYPE =
	'pi-harness-assessment-state';

export const harness_assess_params_schema = Type.Object({
	task: Type.String({
		description:
			'Candidate task to investigate before choosing an execution path',
	}),
});

export const harness_assessment_submit_params_schema = Type.Object({
	task: Type.String({
		description: 'Refined outcome being assessed',
	}),
	evidence: Type.Array(
		Type.String({
			description:
				'Concrete repository, documentation, or observed evidence',
		}),
	),
	existing_primitives: Type.Array(
		Type.String({
			description:
				'Existing mechanisms that already satisfy part or all of the need',
		}),
	),
	rejected_options: Type.Array(
		Type.String({
			description:
				'Rejected option and the evidence-based reason for rejection',
		}),
	),
	smallest_vertical_slice: Type.String({
		description:
			'Smallest useful outcome or experiment that can test the need',
	}),
	recommendation: Type.Union([
		Type.Literal('harness'),
		Type.Literal('direct'),
		Type.Literal('reject'),
	]),
	proposed_contract: Type.Optional(harness_create_params_schema),
});

export type HarnessAssessParams = Static<
	typeof harness_assess_params_schema
>;
export type HarnessAssessmentRecord = Static<
	typeof harness_assessment_submit_params_schema
>;
export type HarnessAssessmentRecommendation =
	HarnessAssessmentRecord['recommendation'];
export type HarnessAssessmentSource =
	| 'agent'
	| 'user'
	| 'harness-create';
export type HarnessAssessmentStatus =
	| 'assessing'
	| 'awaiting_approval'
	| 'approved'
	| 'rejected';

export interface HarnessAssessmentState {
	id: string;
	version: number;
	status: HarnessAssessmentStatus;
	task: string;
	source: HarnessAssessmentSource;
	started_at: string;
	tools_before_assessment: string[];
	record?: HarnessAssessmentRecord;
	decision?: HarnessAssessmentRecommendation;
}

const ASSESSMENT_TOOL_NAMES = new Set([
	'bash',
	'context_get',
	'context_list',
	'context_search',
	'context_stats',
	'find',
	'grep',
	'harness_assess',
	'harness_assessment_submit',
	'harness_read',
	'ls',
	'lsp_definition',
	'lsp_diagnostics',
	'lsp_diagnostics_many',
	'lsp_document_symbols',
	'lsp_find_symbol',
	'lsp_hover',
	'lsp_references',
	'mcp__mcp-omnisearch__ai_search',
	'mcp__mcp-omnisearch__web_extract',
	'mcp__mcp-omnisearch__web_search',
	'mcp__mcp-sqlite-tools__close_database',
	'mcp__mcp-sqlite-tools__database_info',
	'mcp__mcp-sqlite-tools__describe_table',
	'mcp__mcp-sqlite-tools__execute_read_query',
	'mcp__mcp-sqlite-tools__export_schema',
	'mcp__mcp-sqlite-tools__list_databases',
	'mcp__mcp-sqlite-tools__list_tables',
	'mcp__mcp-sqlite-tools__open_database',
	'read',
]);

const SAFE_COMMAND_PATTERNS = [
	/^(?:pwd|whoami|uname|date|uptime)(?:\s+.*)?$/,
	/^(?:cat|head|tail|less|more|grep|rg|ls|wc|sort|uniq|diff|file|stat|du|df|tree|which|whereis|type|bat|eza)(?:\s+.*)?$/,
	/^find(?:\s+.*)?$/,
	/^git\s+(?:status|log|diff|show|rev-parse|ls-files|ls-tree|grep)(?:\s+.*)?$/,
	/^git\s+branch(?:\s+(?:--list|-a|--all|-r|--remotes|--show-current|--contains|--merged|--no-merged)(?:\s+.*)?)?$/,
	/^git\s+remote(?:\s+(?:-v|show|get-url)(?:\s+.*)?)?$/,
	/^git\s+config\s+--get(?:\s+.*)?$/,
	/^gh\s+(?:issue\s+(?:list|view)|pr\s+(?:list|view|diff|checks)|repo\s+view)(?:\s+.*)?$/,
	/^gh\s+api(?:\s+.*)?$/,
	/^(?:npm|pnpm|yarn)\s+(?:list|ls|view|info|why|outdated)(?:\s+.*)?$/,
	/^(?:node|python|python3)\s+--version$/,
	/^jq(?:\s+.*)?$/,
	/^sed\s+-n(?:\s+.*)?$/,
];

const UNSAFE_READ_COMMAND_PATTERNS = [
	/\bfind\b.*\s-(?:delete|exec|execdir|ok|okdir|fprint|fprintf|fls)\b/i,
	/\brg\b.*\s--pre(?:-glob)?\b/i,
	/\b(?:git\s+(?:log|diff|show)|sort)\b.*(?:\s--output(?:=|\s+)|\s-o\s+)/i,
	/\bsed\b.*\s-i(?:\s|$|[^a-z])/i,
	/\bgh\s+api\b.*(?:\s-X\s*|\s--method(?:=|\s+))(?!GET\b)/i,
	/\bgh\s+api\b.*(?:\s-f\s|\s-F\s|\s--field(?:=|\s+)|\s--raw-field(?:=|\s+))/i,
	/\bgit\s+branch\b.*\s-[dDmM]\b/i,
];

export function create_assessment_state(
	task: string,
	source: HarnessAssessmentSource,
	tools_before_assessment: string[],
	now = new Date(),
): HarnessAssessmentState {
	const normalized_task = task.trim();
	if (!normalized_task) {
		throw new Error('Assessment task is required');
	}
	return {
		id: `assessment-${now.getTime().toString(36)}`,
		version: 1,
		status: 'assessing',
		task: normalized_task,
		source,
		started_at: now.toISOString(),
		tools_before_assessment: [...new Set(tools_before_assessment)],
	};
}

export function submit_assessment_record(
	state: HarnessAssessmentState,
	record: HarnessAssessmentRecord,
): HarnessAssessmentState {
	if (record.recommendation === 'harness') {
		if (!record.proposed_contract) {
			throw new Error(
				'A harness recommendation requires a proposed contract',
			);
		}
		if (!record.proposed_contract.allowed_paths?.length) {
			throw new Error(
				'An approved harness contract requires explicit allowed paths',
			);
		}
		if (!record.proposed_contract.validation_commands?.length) {
			throw new Error(
				'An approved harness contract requires validation commands',
			);
		}
	}
	return {
		...state,
		version: state.version + 1,
		status: 'awaiting_approval',
		task: record.task.trim(),
		record,
		decision: undefined,
	};
}

export function assessment_active(
	state: HarnessAssessmentState | undefined,
): boolean {
	return (
		state?.status === 'assessing' ||
		state?.status === 'awaiting_approval'
	);
}

export function assessment_tool_names(
	active_tool_names: string[],
): string[] {
	const read_tools = [...new Set(active_tool_names)].filter((name) =>
		ASSESSMENT_TOOL_NAMES.has(name),
	);
	return [
		...new Set([
			...read_tools,
			'harness_assess',
			'harness_assessment_submit',
			'harness_read',
		]),
	];
}

export function is_assessment_tool_allowed(
	tool_name: string,
): boolean {
	return ASSESSMENT_TOOL_NAMES.has(tool_name);
}

function has_unquoted_shell_control(command: string): boolean {
	let quote: 'single' | 'double' | undefined;
	for (let index = 0; index < command.length; index++) {
		const character = command[index];
		const next = command[index + 1];
		if (quote === 'single') {
			if (character === "'") quote = undefined;
			continue;
		}
		if (quote === 'double') {
			if (character === '\\') {
				index++;
				continue;
			}
			if (character === '"') {
				quote = undefined;
				continue;
			}
			if (character === '`' || (character === '$' && next === '(')) {
				return true;
			}
			continue;
		}
		if (character === '\\') {
			index++;
			continue;
		}
		if (character === "'") {
			quote = 'single';
			continue;
		}
		if (character === '"') {
			quote = 'double';
			continue;
		}
		if (
			character === '\n' ||
			character === '\r' ||
			character === ';' ||
			character === '&' ||
			character === '|' ||
			character === '<' ||
			character === '>' ||
			character === '`' ||
			(character === '$' && next === '(')
		) {
			return true;
		}
	}
	return quote !== undefined;
}

export function check_assessment_command(
	command: string,
): { ok: true } | { ok: false; reason: string } {
	const normalized = command.trim();
	if (!normalized) {
		return { ok: false, reason: 'Assessment mode: empty command' };
	}
	if (
		has_unquoted_shell_control(normalized) ||
		UNSAFE_READ_COMMAND_PATTERNS.some((pattern) =>
			pattern.test(normalized),
		)
	) {
		return {
			ok: false,
			reason:
				'Assessment mode: shell composition or a mutating command option is not allowed',
		};
	}
	if (
		!SAFE_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized))
	) {
		return {
			ok: false,
			reason:
				'Assessment mode: command is not in the read-only allowlist; use one read command per call',
		};
	}
	return { ok: true };
}

export function assessment_context(
	state: HarnessAssessmentState,
): string {
	const approval =
		state.status === 'awaiting_approval'
			? 'An assessment record is waiting for direct user approval. Do not start implementation or call harness_create.'
			: 'Investigate with read-only tools, then call harness_assessment_submit with one evidence-based recommendation.';
	return `## Active harness assessment\n\nAssessment: \`${state.id}\` v${state.version}\nTask: ${state.task}\n\nRepository mutation is disabled. Treat proposed capabilities as candidates, not tasks. Establish the current source of truth, find existing primitives, reject unsupported options, and define the smallest useful vertical slice. A harness contract is optional and is valid only when the evidence shows that an enforceable execution contract adds value. Bash accepts one allowlisted read command per call; use the dedicated read, find, grep, LSP, and research tools when available.\n\n${approval}`;
}

export function format_assessment_record(
	state: HarnessAssessmentState,
): string {
	const record = state.record;
	if (!record) {
		return `Assessment ${state.id} v${state.version}: ${state.status}\n\nTask: ${state.task}`;
	}
	const list = (values: string[], empty: string) =>
		values.length
			? values.map((value) => `- ${value}`).join('\n')
			: `- ${empty}`;
	const contract = record.proposed_contract;
	const contract_section = contract
		? `\n\n## Proposed harness contract\n\n- Task: ${contract.task}\n- Cwd: ${contract.cwd ?? 'current project'}\n- Allowed paths: ${contract.allowed_paths?.join(', ') ?? 'none'}\n- Validation: ${contract.validation_commands?.join(' && ') ?? 'none'}\n- Test changes: ${contract.allow_test_changes ? 'allowed' : 'not allowed'}\n- Forbidden paths: ${contract.forbidden_paths?.join(', ') ?? 'defaults'}\n- Forbidden commands: ${contract.forbidden_commands?.join(', ') ?? 'defaults'}\n- Escalation rules: ${contract.escalation_rules?.join('; ') ?? 'defaults'}\n- Planner: ${contract.planner_model ?? 'default'} (${contract.planner_thinking ?? 'default'})\n- Executor: ${contract.executor_model ?? 'default'} (${contract.executor_thinking ?? 'default'})\n- Reviewer: ${contract.reviewer_model ?? 'default'} (${contract.reviewer_thinking ?? 'default'})`
		: '';
	return `# Harness assessment: ${state.id} v${state.version}\n\n- Status: ${state.status}\n- Recommendation: ${record.recommendation}\n\n## Outcome\n\n${record.task}\n\n## Evidence\n\n${list(record.evidence, 'No evidence recorded')}\n\n## Existing primitives\n\n${list(record.existing_primitives, 'None found')}\n\n## Rejected options\n\n${list(record.rejected_options, 'None recorded')}\n\n## Smallest vertical slice\n\n${record.smallest_vertical_slice}${contract_section}`;
}
