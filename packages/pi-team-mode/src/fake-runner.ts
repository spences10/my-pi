import {
	TeamStore,
	type TeamMessage,
	type TeamTask,
} from './store.js';

export interface FakeTeammateStepOptions {
	complete?: boolean;
	result?: string;
	shutdownOnMessage?: boolean;
}

export interface FakeTeammateStepResult {
	member: string;
	messages: TeamMessage[];
	task?: TeamTask;
	completed?: TeamTask;
	shutdown: boolean;
	summary: string;
}

function wants_shutdown(messages: TeamMessage[]): boolean {
	return messages.some((message) =>
		/\b(stop|shutdown|exit|done)\b/i.test(message.body),
	);
}

export function fake_teammate_step(
	store: TeamStore,
	team_id: string,
	member: string,
	options: FakeTeammateStepOptions = {},
): FakeTeammateStepResult {
	store.upsert_member(team_id, { name: member, status: 'running' });
	const messages = store.mark_messages_read(team_id, member);
	const should_shutdown =
		options.shutdownOnMessage === true && wants_shutdown(messages);

	if (should_shutdown) {
		store.upsert_member(team_id, { name: member, status: 'offline' });
		return {
			member,
			messages,
			shutdown: true,
			summary: `${member} read ${messages.length} message(s) and shut down`,
		};
	}

	const current_task = store
		.list_tasks(team_id)
		.find(
			(task) =>
				task.assignee === member && task.status === 'in_progress',
		);
	const task = current_task ?? store.claim_next_task(team_id, member);

	if (!task) {
		store.upsert_member(team_id, { name: member, status: 'idle' });
		return {
			member,
			messages,
			shutdown: false,
			summary: `${member} read ${messages.length} message(s); no ready task`,
		};
	}

	if (options.complete === false) {
		store.upsert_member(team_id, { name: member, status: 'running' });
		return {
			member,
			messages,
			task,
			shutdown: false,
			summary: `${member} is working on #${task.id}: ${task.title}`,
		};
	}

	const completed = store.update_task(team_id, task.id, {
		status: 'completed',
		result:
			options.result ??
			`Fake teammate ${member} completed: ${task.title}`,
	});
	store.upsert_member(team_id, { name: member, status: 'idle' });
	return {
		member,
		messages,
		task,
		completed,
		shutdown: false,
		summary: `${member} completed #${completed.id}: ${completed.title}`,
	};
}

export function fake_teammate_run_until_idle(
	store: TeamStore,
	team_id: string,
	member: string,
	options: FakeTeammateStepOptions & { maxSteps?: number } = {},
): FakeTeammateStepResult[] {
	const max_steps = options.maxSteps ?? 20;
	const results: FakeTeammateStepResult[] = [];
	for (let i = 0; i < max_steps; i++) {
		const result = fake_teammate_step(
			store,
			team_id,
			member,
			options,
		);
		results.push(result);
		if (result.shutdown || !result.completed) break;
	}
	return results;
}
