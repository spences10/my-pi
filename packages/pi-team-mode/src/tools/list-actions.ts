import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { body_chunk_metadata } from '../chunking.js';
import {
	format_artifacts,
	format_groups,
	format_sessions,
} from '../coordination-formatting.js';
import type { TeamDatabase } from '../db/index.js';
import {
	format_team_page,
	paginate_team_items,
} from '../pagination.js';
import type { TeamToolParams } from '../team-tool-params.js';

interface ListActionContext {
	ctx: Pick<ExtensionContext, 'cwd'>;
	coordination_db: TeamDatabase;
}

export function execute_session_list_action(
	params: TeamToolParams,
	context: ListActionContext,
) {
	const { ctx, coordination_db } = context;
	coordination_db.mark_stale_sessions_offline();
	const full = params.mode === 'full';
	const include_offline =
		params.include_offline || params.include_read;
	const all_sessions = coordination_db.list_sessions({
		include_offline: true,
	});
	const visible_sessions = all_sessions.filter(
		(session) =>
			(params.global || session.cwd === ctx.cwd) &&
			(include_offline || session.status !== 'offline'),
	);
	const { items: sessions, pagination } = paginate_team_items(
		visible_sessions,
		params,
	);
	const warning =
		params.global && include_offline && full
			? 'Global offline session history in full detail is paginated. Prefer project-scoped compact listings when possible.'
			: undefined;
	return {
		content: [
			{
				type: 'text' as const,
				text: format_team_page(
					params.action,
					format_sessions(sessions, {
						full_ids: full,
						target_ids: all_sessions.map(
							(session) => session.session_id,
						),
					}),
					pagination,
					{ warning },
				),
			},
		],
		details: { sessions, ...pagination },
	};
}

export function execute_artifact_list_action(
	params: TeamToolParams,
	context: ListActionContext,
) {
	const { ctx, coordination_db } = context;
	const visible_artifacts = params.query
		? coordination_db.search_artifacts(params.query, {
				cwd: params.global ? undefined : ctx.cwd,
			})
		: coordination_db.list_artifacts({
				cwd: params.global ? undefined : ctx.cwd,
				kind: params.kind,
			});
	const { items: artifacts, pagination } = paginate_team_items(
		visible_artifacts,
		params,
	);
	return {
		content: [
			{
				type: 'text' as const,
				text: format_team_page(
					params.action,
					format_artifacts(artifacts),
					pagination,
				),
			},
		],
		details: {
			artifacts: artifacts.map((artifact) => ({
				artifact_id: artifact.artifact_id,
				kind: artifact.kind,
				title: artifact.title,
				...body_chunk_metadata(artifact.body),
			})),
			...pagination,
		},
	};
}

export function execute_group_list_action(
	params: TeamToolParams,
	context: ListActionContext,
) {
	const { ctx, coordination_db } = context;
	const visible_groups = coordination_db
		.list_groups()
		.filter((group) => params.global || group.cwd === ctx.cwd);
	const { items: groups, pagination } = paginate_team_items(
		visible_groups,
		params,
	);
	const members = new Map(
		groups.map((group) => [
			group.group_id,
			coordination_db.list_group_members(group.group_id),
		]),
	);
	return {
		content: [
			{
				type: 'text' as const,
				text: format_team_page(
					params.action,
					format_groups(groups, members),
					pagination,
				),
			},
		],
		details: { groups, ...pagination },
	};
}
