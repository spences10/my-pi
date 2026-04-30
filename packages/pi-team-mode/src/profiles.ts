import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export const PROJECT_TEAM_PROFILES_ENV =
	'MY_PI_TEAM_PROFILES_PROJECT';

export type TeammateProfileSource = 'user' | 'project';

export interface TeammateProfile {
	name: string;
	description?: string;
	model?: string;
	thinking?: string;
	system_prompt?: string;
	prompt?: string;
	tools?: string[];
	skills?: string[];
	source: TeammateProfileSource;
	path: string;
}

export interface LoadTeammateProfilesOptions {
	cwd: string;
	agent_dir: string;
	env?: NodeJS.ProcessEnv;
}

function should_load_project_profiles(
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	const normalized = env[PROJECT_TEAM_PROFILES_ENV]
		?.trim()
		.toLowerCase();
	return !['0', 'false', 'no', 'skip', 'disable'].includes(
		normalized ?? '',
	);
}

function safe_profile_name(value: string): string | undefined {
	const trimmed = value.trim();
	if (!trimmed || trimmed === '.' || trimmed === '..')
		return undefined;
	if (!/^[a-zA-Z0-9_.-]+$/.test(trimmed)) return undefined;
	return trimmed;
}

function string_array(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const values = value
		.map((item) => (typeof item === 'string' ? item.trim() : ''))
		.filter(Boolean);
	return values.length ? [...new Set(values)] : undefined;
}

function optional_string(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim()
		? value.trim()
		: undefined;
}

function read_profile_file(
	path: string,
	source: TeammateProfileSource,
): TeammateProfile | undefined {
	try {
		const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Record<
			string,
			unknown
		>;
		const fallback_name = basename(path).replace(/\.json$/i, '');
		const name = safe_profile_name(
			optional_string(parsed.name) ?? fallback_name,
		);
		if (!name) return undefined;
		return {
			name,
			...(optional_string(parsed.description)
				? { description: optional_string(parsed.description) }
				: {}),
			...(optional_string(parsed.model)
				? { model: optional_string(parsed.model) }
				: {}),
			...(optional_string(parsed.thinking)
				? { thinking: optional_string(parsed.thinking) }
				: {}),
			...(optional_string(parsed.system_prompt ?? parsed.systemPrompt)
				? {
						system_prompt: optional_string(
							parsed.system_prompt ?? parsed.systemPrompt,
						),
					}
				: {}),
			...(optional_string(parsed.prompt)
				? { prompt: optional_string(parsed.prompt) }
				: {}),
			...(string_array(parsed.tools)
				? { tools: string_array(parsed.tools) }
				: {}),
			...(string_array(parsed.skills)
				? { skills: string_array(parsed.skills) }
				: {}),
			source,
			path,
		};
	} catch {
		return undefined;
	}
}

function read_profiles_dir(
	dir: string,
	source: TeammateProfileSource,
): TeammateProfile[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
		.sort((a, b) => a.name.localeCompare(b.name))
		.flatMap((entry) => {
			const profile = read_profile_file(
				join(dir, entry.name),
				source,
			);
			return profile ? [profile] : [];
		});
}

export function get_user_profiles_dir(agent_dir: string): string {
	return join(agent_dir, 'team-profiles');
}

export function get_project_profiles_dir(cwd: string): string {
	return join(cwd, '.pi', 'team-profiles');
}

export function load_teammate_profiles(
	options: LoadTeammateProfilesOptions,
): Map<string, TeammateProfile> {
	const profiles = new Map<string, TeammateProfile>();
	for (const profile of read_profiles_dir(
		get_user_profiles_dir(options.agent_dir),
		'user',
	)) {
		profiles.set(profile.name, profile);
	}
	if (should_load_project_profiles(options.env)) {
		for (const profile of read_profiles_dir(
			get_project_profiles_dir(options.cwd),
			'project',
		)) {
			profiles.set(profile.name, profile);
		}
	}
	return profiles;
}

export function resolve_teammate_profile(
	options: LoadTeammateProfilesOptions,
	name: string | undefined,
): TeammateProfile | undefined {
	if (!name) return undefined;
	const normalized = safe_profile_name(name);
	if (!normalized)
		throw new Error(`Invalid teammate profile name: ${name}`);
	const profiles = load_teammate_profiles(options);
	const profile = profiles.get(normalized);
	if (!profile)
		throw new Error(`Unknown teammate profile: ${normalized}`);
	return profile;
}
