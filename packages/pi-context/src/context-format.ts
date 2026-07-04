import {
	CONTEXT_SETTINGS_PRESETS,
	get_context_capture_limits,
	get_context_mcp_output_limits,
	get_context_settings_config_path,
	load_context_settings_config,
} from './config.js';
import {
	is_context_sidecar_enabled,
	type ContextChunk,
	type ContextChunkSummary,
	type ContextListResult,
	type ContextPurgeDetails,
	type ContextSearchResult,
	type ContextStats,
} from './store.js';
import { format_bytes } from './text.js';

export function format_search_results(
	results: ContextSearchResult[],
): string {
	if (results.length === 0) return 'No indexed context matched.';
	const body = results
		.map((result, index) =>
			[
				`## ${index + 1}. ${result.title ?? result.chunk_id}`,
				`Source: ${result.source_id} • Chunk: ${result.chunk_id} • Tool: ${result.tool_name}${result.snippet ? ' • Snippet' : ''}`,
				'',
				result.content,
			].join('\n'),
		)
		.join('\n\n---\n\n');
	if (!results.some((result) => result.snippet)) return body;
	return [
		body,
		'',
		'Next actions:',
		'- Need surrounding context? Use context_get with source_id plus this chunk_id and before/after, e.g. before:1 after:1 (max 3).',
		'- Need broad/full JSON/log/script processing? Prefer context_export, then use rg/jq/Python on the file.',
		'- Need full matched chunks in chat? Rerun context_search with full_content:true only for small matches.',
	].join('\n');
}

export function format_get_result(
	source_id: string,
	chunk_id: string | undefined,
	chunks: ContextChunk[],
	summary: ContextChunkSummary | null,
): string {
	if (chunks.length > 0) {
		return chunks
			.map((chunk) =>
				[
					`## ${chunk.id}`,
					`Source: ${chunk.source_id} • Chunk ${chunk.ordinal}`,
					'',
					chunk.content,
				].join('\n'),
			)
			.join('\n\n---\n\n');
	}

	if (!summary) {
		return [
			`Source ${source_id} was not found in the context sidecar.`,
			'It may have expired, been purged, or belonged to a different local context database.',
			'Try context_list to inspect available sources, or rerun the original tool if the content is still needed.',
		].join('\n');
	}

	if (!chunk_id) return 'No chunks found.';
	const range =
		summary.first_chunk_id === summary.last_chunk_id
			? summary.first_chunk_id
			: `${summary.first_chunk_id} … ${summary.last_chunk_id}`;
	return [
		`No chunk found for chunk_id "${chunk_id}".`,
		`Source ${source_id} has ${summary.chunk_count} chunk(s): ${range}.`,
		`Valid ordinals: ${summary.first_ordinal} … ${summary.last_ordinal}.`,
		summary.first_chunk_id
			? `Try chunk_id:"${summary.first_chunk_id}" or chunk_id:"1".`
			: undefined,
	]
		.filter((line): line is string => line !== undefined)
		.join('\n');
}

export function format_list_results(
	results: ContextListResult[],
	options: { audience?: 'tool' | 'tui' } = { audience: 'tool' },
): string {
	if (results.length === 0)
		return 'No indexed context sources found.';
	return results
		.map((result) =>
			[
				options.audience === 'tui'
					? result.source_id
					: `## ${result.source_id}`,
				`Created: ${new Date(result.created_at).toISOString()} • Tool: ${result.tool_name}`,
				`Size: ${format_bytes(result.bytes)}, ${result.lines.toLocaleString()} lines, ${result.chunk_count.toLocaleString()} chunks`,
				`Project: ${result.project_path ?? '(none)'}`,
				`Session: ${result.session_id ?? '(none)'}`,
				result.input_summary
					? `Input: ${result.input_summary}`
					: undefined,
				result.first_chunk_title
					? `First chunk: ${result.first_chunk_title}`
					: undefined,
				result.preview ? `Preview: ${result.preview}` : undefined,
			]
				.filter(Boolean)
				.join('\n'),
		)
		.join('\n\n');
}

export function format_purge_details(
	details: ContextPurgeDetails,
): string {
	const filters = [
		details.source_id ? `source_id=${details.source_id}` : undefined,
		details.project_path !== undefined
			? `project_path=${details.project_path ?? '(none)'}`
			: undefined,
		details.session_id !== undefined
			? `session_id=${details.session_id ?? '(none)'}`
			: undefined,
		details.older_than_days !== undefined
			? `older_than_days=${details.older_than_days}`
			: undefined,
	]
		.filter(Boolean)
		.join(', ');
	return `Deleted ${details.deleted} context source(s).${filters ? ` Filters: ${filters}.` : ''}`;
}

export function format_stats(
	stats: ContextStats,
	options: { audience?: 'tool' | 'tui'; title?: boolean } = {
		audience: 'tool',
		title: true,
	},
): string {
	const scoped = stats.scope_project_path || stats.scope_session_id;
	const rows = [
		`Enabled: ${is_context_sidecar_enabled()}`,
		scoped
			? `Scope: project=${stats.scope_project_path ?? '(none)'}, session=${stats.scope_session_id ?? '(none)'}`
			: 'Scope: global',
		`Reduction: ${stats.reduction_pct}%`,
		`Saved from chat: ${format_bytes(stats.bytes_saved)} (${stats.bytes_saved.toLocaleString()} bytes)`,
		`Sources: ${stats.sources.toLocaleString()}`,
		`Chunks: ${stats.chunks.toLocaleString()}`,
		`Raw stored: ${format_bytes(stats.bytes_stored)} (${stats.bytes_stored.toLocaleString()} bytes)`,
		`Returned to chat: ${format_bytes(stats.bytes_returned)} (${stats.bytes_returned.toLocaleString()} bytes)`,
		`Database size: ${format_bytes(stats.total_bytes)} (${stats.total_bytes.toLocaleString()} bytes)`,
		`Oldest source: ${format_timestamp(stats.oldest_created_at)}`,
		`Newest source: ${format_timestamp(stats.newest_created_at)}`,
		`Retention days: ${stats.retention_days ?? 'disabled'}`,
		`Purge on shutdown: ${stats.purge_on_shutdown}`,
		`Max DB size: ${stats.max_mb === null ? 'disabled' : `${stats.max_mb} MiB`}`,
	];
	if (options.audience === 'tui')
		return [
			...(options.title === false
				? []
				: ['context-sidecar stats', '']),
			...rows,
		].join('\n');
	return [
		...(options.title === false
			? []
			: ['## context-sidecar stats', '']),
		...rows.map((row) => `- ${row}`),
	].join('\n');
}

export function format_timestamp(timestamp: number | null): string {
	return timestamp === null
		? '(none)'
		: new Date(timestamp).toISOString();
}

export function format_days(days: number | null): string {
	return days === null ? 'disabled' : `${days} day(s)`;
}

export function format_max_mb(max_mb: number | null): string {
	return max_mb === null ? 'disabled' : `${max_mb} MiB`;
}

export function format_kib(bytes: number): string {
	return `${Math.round(bytes / 1024)} KiB`;
}

export function format_output_limit(
	bytes: number,
	lines: number,
): string {
	return `${format_kib(bytes)} / ${lines} lines`;
}

export function format_context_settings_status(
	stats: ContextStats,
	options: { audience?: 'tool' | 'tui'; title?: boolean } = {
		audience: 'tool',
		title: true,
	},
): string {
	const saved = load_context_settings_config();
	const capture_limits = get_context_capture_limits();
	const mcp_limits = get_context_mcp_output_limits();
	const rows = [
		`Config path: ${get_context_settings_config_path()}`,
		`Saved preset: ${saved?.preset ?? '(none; using built-in defaults)'}`,
		`Effective retention: ${format_days(stats.retention_days)}`,
		`Effective max size: ${format_max_mb(stats.max_mb)}`,
		`Effective purge on shutdown: ${stats.purge_on_shutdown}`,
		`Effective tool capture threshold: ${format_output_limit(capture_limits.max_bytes, capture_limits.max_lines)}`,
		`Effective MCP capture threshold: ${format_output_limit(mcp_limits.max_bytes, mcp_limits.max_lines)}`,
	];
	const presets = Object.entries(CONTEXT_SETTINGS_PRESETS).map(
		([key, preset]) => `${key}: ${preset.description}`,
	);
	const usage = [
		'/context settings <preset>',
		'/context settings custom <days|off> <max-mb|off> [capture-kb] [capture-lines] [purge-on-shutdown]',
	];
	if (options.audience === 'tui')
		return [
			...(options.title === false
				? []
				: ['context-sidecar settings', '']),
			...rows,
			'',
			'Presets:',
			...presets,
			'',
			'Usage:',
			...usage,
		].join('\n');
	return [
		...(options.title === false
			? []
			: ['## context-sidecar settings', '']),
		...rows.map((row) => `- ${row}`),
		'',
		'Presets:',
		...presets.map((preset) => `- ${preset}`),
		'',
		'Usage:',
		...usage.map((line) => `- ${line}`),
	].join('\n');
}
