import { getAgentDir } from '@mariozechner/pi-coding-agent';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEAM_ROOT_ENV = 'MY_PI_TEAM_MODE_ROOT';
export const ACTIVE_TEAM_ENV = 'MY_PI_ACTIVE_TEAM_ID';
export const TEAM_MEMBER_ENV = 'MY_PI_TEAM_MEMBER';
export const TEAM_ROLE_ENV = 'MY_PI_TEAM_ROLE';
export const EXTENSION_PATH_ENV = 'MY_PI_TEAM_EXTENSION_PATH';
export const AUTO_INJECT_ENV = 'MY_PI_TEAM_AUTO_INJECT_MESSAGES';

export function get_team_root(): string {
	return (
		process.env[TEAM_ROOT_ENV] || join(getAgentDir(), 'teams-local')
	);
}

export function get_extension_path(): string {
	return (
		process.env[EXTENSION_PATH_ENV] || fileURLToPath(import.meta.url)
	);
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
