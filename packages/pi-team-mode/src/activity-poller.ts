import type {
	ExtensionAPI,
	ExtensionContext,
} from '@mariozechner/pi-coding-agent';
import {
	format_injected_messages,
	summarize_result,
} from './formatting.js';
import type { RpcTeammate } from './rpc-runner.js';
import { get_team_status } from './runner-orchestration.js';
import { TeamStore } from './store.js';
import { set_team_ui } from './ui-status.js';

export interface TeamActivityPollerOptions {
	store: TeamStore;
	runners: Map<string, RpcTeammate>;
	own_member: string;
	own_role: string;
	get_active_team_id: () => string | undefined;
	clear_active_team_id: () => void;
	should_auto_inject_messages: () => boolean;
}

export class TeamActivityPoller {
	private mailbox_timer: NodeJS.Timeout | undefined;
	private observed_team_id: string | undefined;
	private observed_completed_task_ids = new Set<string>();
	private observed_blocked_task_ids = new Set<string>();

	constructor(private readonly options: TeamActivityPollerOptions) {}

	reset(team_id: string | undefined): void {
		this.observed_team_id = team_id;
		const tasks = team_id
			? this.options.store.list_tasks(team_id)
			: [];
		this.observed_completed_task_ids = new Set(
			tasks
				.filter((task) => task.status === 'completed')
				.map((task) => task.id),
		);
		this.observed_blocked_task_ids = new Set(
			tasks
				.filter((task) => task.status === 'blocked')
				.map((task) => task.id),
		);
	}

	async poll(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
		const active_team_id = this.options.get_active_team_id();
		if (!active_team_id) {
			set_team_ui(
				ctx,
				this.options.store,
				undefined,
				this.options.runners,
			);
			return;
		}
		try {
			if (this.observed_team_id !== active_team_id) {
				this.reset(active_team_id);
			}
			const status = await get_team_status(
				this.options.store,
				active_team_id,
				this.options.runners,
			);
			set_team_ui(
				ctx,
				this.options.store,
				active_team_id,
				this.options.runners,
			);
			if (this.options.own_role !== 'teammate') {
				for (const task of status.tasks) {
					if (
						task.status === 'completed' &&
						!this.observed_completed_task_ids.has(task.id)
					) {
						this.observed_completed_task_ids.add(task.id);
						const result = summarize_result(task.result);
						ctx.ui.notify(
							`Team task #${task.id} completed${task.assignee ? ` by ${task.assignee}` : ''}: ${task.title}${result ? ` — ${result}` : ''}`,
							'info',
						);
					}
					if (
						task.status === 'blocked' &&
						!this.observed_blocked_task_ids.has(task.id)
					) {
						this.observed_blocked_task_ids.add(task.id);
						const result = summarize_result(task.result);
						ctx.ui.notify(
							`Team task #${task.id} blocked${task.assignee ? ` for ${task.assignee}` : ''}: ${task.title}${result ? ` — ${result}` : ''}`,
							'warning',
						);
					}
				}
			}
			if (!this.options.should_auto_inject_messages()) return;
			const unread = this.options.store
				.list_messages(active_team_id, this.options.own_member)
				.filter(
					(message) =>
						!message.acknowledged_at && !message.delivered_at,
				);
			if (unread.length === 0) return;
			pi.sendMessage(
				{
					customType: 'team-message',
					content: format_injected_messages(
						this.options.own_member,
						unread,
					),
					display: true,
					details: { team_id: active_team_id, messages: unread },
				},
				{ deliverAs: 'followUp', triggerTurn: true },
			);
			await this.options.store.mark_messages_delivered(
				active_team_id,
				this.options.own_member,
				unread.map((message) => message.id),
			);
		} catch (error) {
			try {
				this.options.store.load_team(active_team_id);
				this.options.store.append_event(
					active_team_id,
					'team_activity_poll_error',
					{
						member: this.options.own_member,
						error:
							error instanceof Error ? error.message : String(error),
					},
				);
			} catch {
				this.options.clear_active_team_id();
				this.reset(undefined);
				set_team_ui(
					ctx,
					this.options.store,
					undefined,
					this.options.runners,
				);
			}
		}
	}

	start(pi: ExtensionAPI, ctx: ExtensionContext): void {
		this.stop();
		this.mailbox_timer = setInterval(
			() => void this.poll(pi, ctx),
			1000,
		);
		this.mailbox_timer.unref();
	}

	stop(): void {
		if (!this.mailbox_timer) return;
		clearInterval(this.mailbox_timer);
		this.mailbox_timer = undefined;
	}
}
