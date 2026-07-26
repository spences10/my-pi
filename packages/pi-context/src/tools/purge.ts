import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { format_purge_details } from '../context-format.js';
import { scope_from_context } from '../context-scope.js';
import { get_context_store } from '../store.js';

export function register_context_purge_tool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: 'context_purge',
		label: 'Context Purge',
		description:
			'Delete indexed context-sidecar output by age, source, project, session, or active retention policy.',
		parameters: Type.Object({
			expired: Type.Optional(
				Type.Boolean({
					description:
						'Run active retention cleanup now instead of manual age purge',
				}),
			),
			older_than_days: Type.Optional(
				Type.Number({
					description:
						'Delete sources older than this many days; defaults to active retention days or 14',
				}),
			),
			source_id: Type.Optional(
				Type.String({ description: 'Delete one source id' }),
			),
			project_path: Type.Optional(
				Type.String({
					description: 'Limit purge to one project path',
				}),
			),
			session_id: Type.Optional(
				Type.String({ description: 'Limit purge to one session id' }),
			),
			global: Type.Optional(
				Type.Boolean({
					description:
						'Purge all scopes instead of current project/session scope',
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const scope = scope_from_context(ctx);
			const store = get_context_store(scope);
			const stats = store.stats();
			const has_explicit_scope =
				params.project_path !== undefined ||
				params.session_id !== undefined;
			const project_path = params.global
				? params.project_path
				: has_explicit_scope
					? params.project_path
					: scope.project_path;
			const session_id = params.global
				? params.session_id
				: has_explicit_scope
					? params.session_id
					: scope.session_id;
			const details = params.expired
				? { deleted: store.cleanup().deleted }
				: store.purge_with_details({
						project_path,
						session_id,
						older_than_days: params.source_id
							? undefined
							: (params.older_than_days ??
								stats.retention_days ??
								14),
						source_id: params.source_id,
					});
			return {
				content: [
					{
						type: 'text' as const,
						text: format_purge_details(details),
					},
				],
				details,
			};
		},
	});
}
