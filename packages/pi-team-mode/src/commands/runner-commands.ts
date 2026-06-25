import {
	parse_spawn_request,
	profile_prompt,
} from '../command-parser.js';
import {
	require_arg,
	require_lead_for_teammate_spawn,
	teammate_profile,
} from '../command-utils.js';
import {
	get_extension_path,
	get_team_root,
	should_enable_fake_teammate_command,
} from '../config.js';
import { fake_teammate_step } from '../fake-runner.js';
import {
	format_status,
	format_status_counts,
} from '../formatting.js';
import { RpcTeammate } from '../rpc-runner.js';
import {
	attached_member_names,
	get_team_status,
	shutdown_orphaned_member,
	shutdown_team_members,
} from '../runner-orchestration.js';
import {
	has_modal_ui,
	set_team_ui,
	show_team_text_modal,
} from '../ui-status.js';
import {
	require_no_shared_mutating_conflict,
	require_no_worktree_assignment_conflict,
} from '../workspace-guards.js';
import { prepare_teammate_workspace } from '../workspace.js';
import type { TeamCommandDeps } from './types.js';
import { current_model, current_team_id } from './types.js';

export async function handle_spawn(
	deps: TeamCommandDeps,
	rest: string[],
): Promise<void> {
	require_lead_for_teammate_spawn(deps.own_role);
	const request = parse_spawn_request(rest);
	const profile = teammate_profile(deps.ctx.cwd, request.profile);
	const name = request.member;
	const team_id = current_team_id(deps);
	const model = current_model(deps.ctx);
	const existing = deps.runners.get(name);
	if (existing?.is_running) {
		throw new Error(
			`Teammate ${name} is already running. Use /team shutdown ${name} first.`,
		);
	}
	const workspace = prepare_teammate_workspace({
		team_id,
		member: name,
		repo_cwd: deps.ctx.cwd,
		team_root: get_team_root(),
		mode: request.workspace_mode,
		branch: request.branch,
		worktree_path: request.worktree_path,
	});
	await require_no_worktree_assignment_conflict(
		deps.store,
		team_id,
		workspace,
		name,
		request.force,
		attached_member_names(deps.runners),
	);
	if (request.mutating && workspace.workspace_mode === 'shared') {
		await require_no_shared_mutating_conflict(
			deps.store,
			team_id,
			workspace.cwd,
			name,
			request.force,
			attached_member_names(deps.runners),
		);
	}
	const runner = new RpcTeammate(deps.store, {
		team_id,
		member: name,
		cwd: workspace.cwd,
		team_root: get_team_root(),
		extension_path: get_extension_path(),
		model:
			profile?.model ??
			(model ? `${model.provider}/${model.id}` : undefined),
		thinking: profile?.thinking,
		system_prompt: profile?.system_prompt,
		tools: profile?.tools,
		skills: profile?.skills,
		profile: profile?.name,
		workspace_mode: workspace.workspace_mode,
		worktree_path: workspace.worktree_path,
		branch: workspace.branch,
		mutating: request.mutating ?? false,
		on_exit: (member) => deps.runners.delete(member),
	});
	deps.runners.set(name, runner);
	try {
		await runner.start();
	} catch (error) {
		deps.runners.delete(name);
		throw error;
	}
	const initial_prompt = profile_prompt(profile, request.prompt);
	if (initial_prompt) await runner.prompt(initial_prompt);
	set_team_ui(deps.ctx, deps.store, team_id, deps.runners);
	deps.ctx.ui.notify(
		`Spawned teammate ${name}${initial_prompt ? ' and sent prompt' : ''}`,
	);
}

export async function handle_send_prompt(
	deps: TeamCommandDeps,
	rest: string[],
): Promise<void> {
	const [member, ...message_parts] = rest;
	const name = require_arg(member, 'member');
	const runner = deps.runners.get(name);
	if (!runner?.is_running)
		throw new Error(`No running teammate: ${name}`);
	await runner.prompt(message_parts.join(' '));
	deps.ctx.ui.notify(`Sent prompt to ${name}`);
}

export async function handle_steer(
	deps: TeamCommandDeps,
	rest: string[],
): Promise<void> {
	const [member, ...message_parts] = rest;
	const name = require_arg(member, 'member');
	const runner = deps.runners.get(name);
	if (!runner?.is_running)
		throw new Error(`No running teammate: ${name}`);
	await runner.steer(message_parts.join(' '));
	deps.ctx.ui.notify(`Steered ${name}`);
}

export async function handle_shutdown(
	deps: TeamCommandDeps,
	rest: string[],
): Promise<void> {
	const [member, ...reason_parts] = rest;
	if (member === '--all' || member === 'all') {
		const result = await shutdown_team_members(
			deps.store,
			current_team_id(deps),
			deps.runners,
			'all',
			reason_parts.join(' ') || undefined,
		);
		deps.ctx.ui.notify(
			`Shutdown ${result.members.length} teammates${result.errors.length ? `; ${result.errors.length} failed` : ''}`,
		);
	} else if (member === '--done' || member === 'done' || !member) {
		const result = await shutdown_team_members(
			deps.store,
			current_team_id(deps),
			deps.runners,
			'done',
			reason_parts.join(' ') || undefined,
		);
		deps.ctx.ui.notify(
			`Shutdown ${result.members.length} done teammates${result.errors.length ? `; ${result.errors.length} failed` : ''}`,
		);
	} else {
		const name = require_arg(member, 'member');
		const runner = deps.runners.get(name);
		if (runner?.is_running) {
			await runner.shutdown(reason_parts.join(' ') || undefined);
			deps.runners.delete(name);
			await deps.store.upsert_member(current_team_id(deps), {
				name,
				status: 'offline',
			});
			deps.ctx.ui.notify(`Shutdown requested for ${name}`);
		} else {
			const member = await shutdown_orphaned_member(
				deps.store,
				current_team_id(deps),
				name,
			);
			deps.ctx.ui.notify(
				`Terminated orphaned teammate ${name}; status ${member.status}`,
			);
		}
	}
	set_team_ui(
		deps.ctx,
		deps.store,
		deps.get_active_team_id(),
		deps.runners,
	);
}

export async function handle_wait(
	deps: TeamCommandDeps,
	rest: string[],
): Promise<void> {
	const [member] = rest;
	const name = require_arg(member, 'member');
	set_team_ui(
		deps.ctx,
		deps.store,
		deps.get_active_team_id(),
		deps.runners,
	);
	const status = await get_team_status(
		deps.store,
		current_team_id(deps),
		deps.runners,
	);
	const text = `Not blocking on ${name}; teammate work remains in the background.\n\n${format_status(status)}`;
	if (has_modal_ui(deps.ctx)) {
		await show_team_text_modal(deps.ctx, {
			title: 'Team status',
			subtitle: `${status.team.name} • ${format_status_counts(status)}`,
			text,
		});
	} else {
		deps.ctx.ui.notify(text);
	}
}

export async function handle_fake(
	deps: TeamCommandDeps,
	rest: string[],
): Promise<void> {
	if (!should_enable_fake_teammate_command()) {
		throw new Error(
			'Fake teammate runner is disabled. Set MY_PI_TEAM_ENABLE_FAKE=1 for local tests.',
		);
	}
	const [member = 'alice', ...flags] = rest;
	const result = await fake_teammate_step(
		deps.store,
		current_team_id(deps),
		member,
		{
			complete: !flags.includes('--hold'),
			shutdownOnMessage: flags.includes('--shutdown-on-message'),
		},
	);
	set_team_ui(
		deps.ctx,
		deps.store,
		deps.get_active_team_id(),
		deps.runners,
	);
	deps.ctx.ui.notify(result.summary);
}
