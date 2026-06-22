import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { format_list_results } from '../context-format.js';
import { scope_from_context } from '../context-scope.js';
import { get_context_store } from '../store.js';

export function register_context_list_tool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: 'context_list',
		label: 'Context List',
		description:
			'List indexed sources in the local SQLite context sidecar.',
		promptSnippet:
			'List recent indexed context-sidecar sources without knowing a source id',
		parameters: Type.Object({
			source_id: Type.Optional(
				Type.String({ description: 'Limit to one source id' }),
			),
			tool_name: Type.Optional(
				Type.String({ description: 'Limit to one tool name' }),
			),
			project_path: Type.Optional(
				Type.String({ description: 'Limit to one project path' }),
			),
			session_id: Type.Optional(
				Type.String({ description: 'Limit to one session id' }),
			),
			newer_than_days: Type.Optional(
				Type.Number({
					description: 'Only sources newer than N days',
				}),
			),
			older_than_days: Type.Optional(
				Type.Number({
					description: 'Only sources older than N days',
				}),
			),
			limit: Type.Optional(
				Type.Number({ description: 'Maximum sources, default 10' }),
			),
			offset: Type.Optional(
				Type.Number({ description: 'Pagination offset, default 0' }),
			),
			global: Type.Optional(
				Type.Boolean({
					description:
						'List all scopes instead of current project/session scope',
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const scope = scope_from_context(ctx);
			const has_explicit_scope =
				params.project_path !== undefined ||
				params.session_id !== undefined;
			const project_path = has_explicit_scope
				? params.project_path
				: scope.project_path;
			const session_id = has_explicit_scope
				? params.session_id
				: scope.session_id;
			const results = get_context_store(scope).list({
				project_path,
				session_id,
				global: params.global || has_explicit_scope,
				source_id: params.source_id,
				tool_name: params.tool_name,
				newer_than_days: params.newer_than_days,
				older_than_days: params.older_than_days,
				limit: params.limit,
				offset: params.offset,
			});
			return {
				content: [
					{
						type: 'text' as const,
						text: format_list_results(results),
					},
				],
				details: { count: results.length },
			};
		},
	});
}
