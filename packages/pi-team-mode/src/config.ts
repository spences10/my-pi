import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { join } from 'node:path';

export const TEAM_MEMBER_ENV = 'MY_PI_TEAM_MEMBER';
export const TEAM_ROLE_ENV = 'MY_PI_TEAM_ROLE';
export const AUTO_INJECT_ENV = 'MY_PI_TEAM_AUTO_INJECT_MESSAGES';
export const COORDINATION_DB_ENV = 'MY_PI_COORDINATION_DB';
export const TEAM_THINKING_ENV = 'MY_PI_TEAM_THINKING';

export function get_coordination_db_path(): string {
	return (
		process.env[COORDINATION_DB_ENV] ||
		join(getAgentDir(), 'coordination.db')
	);
}

export function get_current_thinking_level(): string | undefined {
	const env_value = process.env[TEAM_THINKING_ENV]?.trim();
	if (env_value) return env_value;
	const index = process.argv.indexOf('--thinking');
	const arg_value =
		index >= 0 ? process.argv[index + 1]?.trim() : undefined;
	return arg_value || undefined;
}

export function should_auto_inject_messages(): boolean {
	const value = process.env[AUTO_INJECT_ENV]?.trim().toLowerCase();
	return !value || !['0', 'false', 'no', 'off'].includes(value);
}
