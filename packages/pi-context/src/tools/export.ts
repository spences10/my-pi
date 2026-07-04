import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { format_get_result } from '../context-format.js';
import { scope_from_context } from '../context-scope.js';
import {
	cleanup_context_exports,
	resolve_context_export_path,
	write_context_export_file,
} from '../export-files.js';
import { get_context_store } from '../store.js';

export function register_context_export_tool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: 'context_export',
		label: 'Context Export',
		description:
			'Export stored chunks from the local SQLite context sidecar to a file without returning chunk content. Prefer this for broad/full JSON/log/script processing; omit chunk_id when intentionally processing the full source offline.',
		promptSnippet:
			'Write stored context-sidecar chunks to a file for offline rg/jq/Python without loading them into model context',
		parameters: Type.Object({
			source_id: Type.String({ description: 'Indexed source id' }),
			file_path: Type.Optional(
				Type.String({
					description:
						'Destination file path. Relative paths resolve from the current working directory. Defaults to the managed context export directory.',
				}),
			),
			chunk_id: Type.Optional(
				Type.String({
					description:
						'Optional exact chunk id or ordinal. Omit only when intentionally exporting the full source for offline processing.',
				}),
			),
			before: Type.Optional(
				Type.Number({
					description:
						'When chunk_id is set, include up to this many chunks before it (max 3). Prefer 1 first; omit chunk_id to export the full source.',
				}),
			),
			after: Type.Optional(
				Type.Number({
					description:
						'When chunk_id is set, include up to this many chunks after it (max 3). Prefer 1 first; omit chunk_id to export the full source.',
				}),
			),
			global: Type.Optional(
				Type.Boolean({
					description:
						'Export across all scopes instead of current project/session scope',
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const scope = scope_from_context(ctx);
			const store = get_context_store(scope);
			const scope_options = {
				...(params.global ? {} : scope),
				global: params.global,
				before: params.before,
				after: params.after,
			};
			const exported = store.export_content(
				params.source_id,
				params.chunk_id,
				scope_options,
			);
			if (exported.chunks.length === 0) {
				const summary = store.chunk_summary(
					params.source_id,
					scope_options,
				);
				return {
					content: [
						{
							type: 'text' as const,
							text: format_get_result(
								params.source_id,
								params.chunk_id,
								exported.chunks,
								summary,
							),
						},
					],
					details: { count: 0, exported: false },
				};
			}

			const cwd = ctx?.cwd ?? process.cwd();
			cleanup_context_exports();
			const file_path = resolve_context_export_path(
				params.file_path,
				cwd,
				params.source_id,
				params.chunk_id,
			);
			write_context_export_file(file_path, exported.content);
			const verification =
				exported.verified === false
					? ' Reconstruction hash did not match the stored source; this source may have been captured by an older non-lossless chunker.'
					: '';

			return {
				content: [
					{
						type: 'text' as const,
						text: `Exported ${exported.chunks.length} chunk(s) from ${params.source_id} to ${file_path}.${verification}`,
					},
				],
				details: {
					count: exported.chunks.length,
					exported: true,
					file_path,
					bytes: Buffer.byteLength(exported.content, 'utf8'),
					verified: exported.verified,
				},
			};
		},
	});
}
