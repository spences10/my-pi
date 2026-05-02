import type {
	TelemetryQueryFilters,
	TelemetryRunSummary,
	TelemetryStats,
} from './db.js';

export const COMMANDS = [
	'status',
	'stats',
	'query',
	'export',
	'on',
	'off',
	'path',
];
export const DEFAULT_QUERY_LIMIT = 20;

export function format_telemetry_status(options: {
	saved_enabled: boolean;
	effective_enabled: boolean;
	override?: boolean;
	db_path: string;
}): string {
	const override_label =
		options.override === undefined
			? 'none'
			: options.override
				? '--telemetry'
				: '--no-telemetry';

	return [
		`telemetry ${options.effective_enabled ? 'enabled' : 'disabled'} now`,
		`default ${options.saved_enabled ? 'enabled' : 'disabled'}`,
		`override ${override_label}`,
		`db ${options.db_path}`,
	].join('\n');
}

function format_bytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KiB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function format_timestamp(timestamp: number): string {
	return new Date(timestamp).toISOString();
}

function format_duration(duration_ms: number | null): string {
	if (duration_ms === null) return 'open';
	if (duration_ms < 1000) return `${duration_ms}ms`;
	if (duration_ms < 60_000) {
		return `${(duration_ms / 1000).toFixed(1)}s`;
	}
	return `${(duration_ms / 60_000).toFixed(1)}m`;
}

function format_success(value: boolean | null): string {
	if (value === true) return 'success';
	if (value === false) return 'failure';
	return 'unknown';
}

function tokenize_command_args(input: string): string[] {
	const matches =
		input.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+/g) ?? [];
	return matches.map((token) => {
		if (
			(token.startsWith('"') && token.endsWith('"')) ||
			(token.startsWith("'") && token.endsWith("'"))
		) {
			return token.slice(1, -1);
		}
		return token;
	});
}

export interface ParsedTelemetryCommand {
	subcommand: string;
	export_path: string | null;
	filters: TelemetryQueryFilters;
	errors: string[];
}

export function parse_telemetry_command(
	input: string,
): ParsedTelemetryCommand {
	const tokens = tokenize_command_args(input.trim());
	const subcommand = tokens[0] ?? 'status';
	const filters: TelemetryQueryFilters = {};
	let export_path: string | null = null;
	const errors: string[] = [];

	for (const token of tokens.slice(1)) {
		const equals_index = token.indexOf('=');
		if (equals_index === -1) {
			if (subcommand === 'export' && export_path === null) {
				export_path = token;
			} else {
				errors.push(`Unexpected argument: ${token}`);
			}
			continue;
		}

		const key = token.slice(0, equals_index);
		const value = token.slice(equals_index + 1);
		switch (key) {
			case 'eval_run_id':
			case 'run':
				filters.eval_run_id = value;
				break;
			case 'eval_case_id':
			case 'case':
				filters.eval_case_id = value;
				break;
			case 'eval_suite':
			case 'suite':
				filters.eval_suite = value;
				break;
			case 'success':
				if (value === 'true') filters.success = true;
				else if (value === 'false') filters.success = false;
				else if (value === 'null') filters.success = null;
				else {
					errors.push(
						`Invalid success value: ${value}. Use true, false, or null`,
					);
				}
				break;
			case 'limit': {
				const parsed = Number.parseInt(value, 10);
				if (!Number.isFinite(parsed) || parsed <= 0) {
					errors.push(
						`Invalid limit value: ${value}. Use a positive integer`,
					);
				} else {
					filters.limit = parsed;
				}
				break;
			}
			default:
				errors.push(`Unknown filter: ${key}`);
		}
	}

	if (subcommand === 'query' && filters.limit === undefined) {
		filters.limit = DEFAULT_QUERY_LIMIT;
	}

	return {
		subcommand,
		export_path,
		filters,
		errors,
	};
}

function format_filter_summary(
	filters: TelemetryQueryFilters,
): string {
	const parts: string[] = [];
	if (filters.eval_run_id !== undefined) {
		parts.push(`eval_run_id=${filters.eval_run_id}`);
	}
	if (filters.eval_case_id !== undefined) {
		parts.push(`eval_case_id=${filters.eval_case_id}`);
	}
	if (filters.eval_suite !== undefined) {
		parts.push(`eval_suite=${filters.eval_suite}`);
	}
	if (filters.success !== undefined) {
		parts.push(`success=${String(filters.success)}`);
	}
	if (filters.limit !== undefined) {
		parts.push(`limit=${filters.limit}`);
	}
	return parts.length > 0 ? parts.join(' ') : 'none';
}

export function format_telemetry_stats(options: {
	db_path: string;
	stats: TelemetryStats;
}): string {
	return [
		`db ${options.db_path}`,
		`schema v${options.stats.schema_version}`,
		`runs ${options.stats.runs}`,
		`turns ${options.stats.turns}`,
		`tool_calls ${options.stats.tool_calls}`,
		`provider_requests ${options.stats.provider_requests}`,
		`db_bytes ${format_bytes(options.stats.db_bytes)}`,
		`wal_bytes ${format_bytes(options.stats.wal_bytes)}`,
		`total_bytes ${format_bytes(options.stats.total_bytes)}`,
	].join('\n');
}

export function format_telemetry_query_results(options: {
	db_path: string;
	filters: TelemetryQueryFilters;
	runs: TelemetryRunSummary[];
}): string {
	if (options.runs.length === 0) {
		return [
			`db ${options.db_path}`,
			`filters ${format_filter_summary(options.filters)}`,
			'no matching runs',
		].join('\n');
	}

	return [
		`db ${options.db_path}`,
		`filters ${format_filter_summary(options.filters)}`,
		...options.runs.map((run) =>
			[
				`${format_timestamp(run.started_at)} ${run.id}`,
				`status=${format_success(run.success)}`,
				`duration=${format_duration(run.duration_ms)}`,
				`turns=${run.turn_count}`,
				`tools=${run.tool_call_count}`,
				`tool_errors=${run.tool_error_count}`,
				`provider_requests=${run.provider_request_count}`,
				run.eval_run_id ? `eval_run_id=${run.eval_run_id}` : null,
				run.eval_case_id ? `eval_case_id=${run.eval_case_id}` : null,
				run.eval_suite ? `eval_suite=${run.eval_suite}` : null,
			]
				.filter(Boolean)
				.join(' '),
		),
	].join('\n');
}
