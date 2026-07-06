import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEAM_ROOT_ENV = 'MY_PI_TEAM_MODE_ROOT';
export const ACTIVE_TEAM_ENV = 'MY_PI_ACTIVE_TEAM_ID';
export const TEAM_MEMBER_ENV = 'MY_PI_TEAM_MEMBER';
export const TEAM_ROLE_ENV = 'MY_PI_TEAM_ROLE';
export const EXTENSION_PATH_ENV = 'MY_PI_TEAM_EXTENSION_PATH';
export const AUTO_INJECT_ENV = 'MY_PI_TEAM_AUTO_INJECT_MESSAGES';
export const COORDINATION_DB_ENV = 'MY_PI_COORDINATION_DB';
export const TEAM_THINKING_ENV = 'MY_PI_TEAM_THINKING';
export const HEADLESS_PARENT_SESSION_ENV =
	'MY_PI_TEAM_PARENT_SESSION_ID';
export const HEADLESS_ALIAS_ENV = 'MY_PI_TEAM_SESSION_ALIAS';
export const HEADLESS_INTENT_ENV = 'MY_PI_TEAM_SESSION_INTENT';
export const HEADLESS_LAUNCH_ENV = 'MY_PI_TEAM_LAUNCH_MODE';

let current_extension_path: string | undefined;

export function set_current_extension_path(path: string): void {
	current_extension_path = path;
}

export function get_team_root(): string {
	return (
		process.env[TEAM_ROOT_ENV] || join(getAgentDir(), 'teams-local')
	);
}

export function get_coordination_db_path(): string {
	return (
		process.env[COORDINATION_DB_ENV] ||
		join(getAgentDir(), 'coordination.db')
	);
}

export function get_extension_path(): string {
	return (
		process.env[EXTENSION_PATH_ENV] ||
		current_extension_path ||
		fileURLToPath(import.meta.url)
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

export function should_enable_fake_teammate_command(): boolean {
	const value =
		process.env.MY_PI_TEAM_ENABLE_FAKE?.trim().toLowerCase();
	return ['1', 'true', 'yes', 'on'].includes(value ?? '');
}
