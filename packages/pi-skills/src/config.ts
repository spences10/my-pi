import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type SkillDefaultPolicy = 'all-enabled' | 'all-disabled';

export interface SkillProfileConfig {
	description?: string;
	extends?: string | string[];
	include?: string[];
	exclude?: string[];
}

export interface SkillsConfig {
	version: number;
	/** Legacy global enablement map. v3 stores enablement in profiles. */
	enabled: Record<string, boolean>;
	/** Legacy fallback policy. v3 stores baseline behavior as profile rules. */
	defaults: SkillDefaultPolicy;
	current_profile?: string;
	profiles: Record<string, SkillProfileConfig>;
}

const DEFAULT_PROFILES: Record<string, SkillProfileConfig> = {
	default: {
		description: 'General-purpose skills profile.',
		include: [],
		exclude: [],
	},
};

const DEFAULT_CONFIG: SkillsConfig = {
	version: 3,
	enabled: {},
	defaults: 'all-disabled',
	current_profile: 'default',
	profiles: DEFAULT_PROFILES,
};

export function get_config_path(): string {
	const xdg =
		process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
	return join(xdg, 'my-pi', 'skills.json');
}

function string_array(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const values = value
		.map((item) => (typeof item === 'string' ? item.trim() : ''))
		.filter(Boolean);
	return values.length ? [...new Set(values)] : undefined;
}

function normalize_profile(value: unknown): SkillProfileConfig {
	if (!value || typeof value !== 'object') return {};
	const parsed = value as Record<string, unknown>;
	const description =
		typeof parsed.description === 'string' &&
		parsed.description.trim()
			? parsed.description.trim()
			: undefined;
	const extends_value = Array.isArray(parsed.extends)
		? string_array(parsed.extends)
		: typeof parsed.extends === 'string' && parsed.extends.trim()
			? parsed.extends.trim()
			: undefined;

	const include = string_array(parsed.include);
	const exclude = string_array(parsed.exclude);
	const profile: SkillProfileConfig = {};
	if (description) profile.description = description;
	if (extends_value) profile.extends = extends_value;
	if (include) profile.include = include;
	if (exclude) profile.exclude = exclude;
	return profile;
}

function normalize_profiles(
	value: unknown,
): Record<string, SkillProfileConfig> {
	if (!value || typeof value !== 'object') {
		return structuredClone(DEFAULT_PROFILES);
	}

	const profiles: Record<string, SkillProfileConfig> = {};
	for (const [name, profile] of Object.entries(
		value as Record<string, unknown>,
	)) {
		if (!safe_profile_name(name)) continue;
		profiles[name] = normalize_profile(profile);
	}

	return Object.keys(profiles).length
		? profiles
		: structuredClone(DEFAULT_PROFILES);
}

function unique_push(values: string[], value: string): void {
	if (!values.includes(value)) values.push(value);
}

function remove_value(values: string[], value: string): string[] {
	return values.filter((item) => item !== value);
}

function normalize_enabled_map(
	value: unknown,
): Record<string, boolean> {
	if (!value || typeof value !== 'object') return {};
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.filter(
				(entry): entry is [string, boolean] =>
					typeof entry[1] === 'boolean' && Boolean(entry[0].trim()),
			)
			.map(([key, enabled]) => [key.trim(), enabled]),
	);
}

function migrate_legacy_enablement_to_default_profile(
	profiles: Record<string, SkillProfileConfig>,
	enabled: Record<string, boolean>,
	defaults: SkillDefaultPolicy,
): Record<string, SkillProfileConfig> {
	const migrated = { ...profiles };
	const base_default = {
		...DEFAULT_PROFILES.default,
		...migrated.default,
	};
	let include = [...(base_default.include ?? [])];
	let exclude = [...(base_default.exclude ?? [])];

	if (defaults === 'all-enabled') {
		unique_push(include, '*');
	}

	for (const [key, is_enabled] of Object.entries(enabled)) {
		if (is_enabled) {
			exclude = remove_value(exclude, key);
			unique_push(include, key);
		} else {
			include = remove_value(include, key);
			unique_push(exclude, key);
		}
	}

	migrated.default = {
		...base_default,
		include,
		exclude,
	};
	return migrated;
}

export function safe_profile_name(value: string): string | undefined {
	const trimmed = value.trim();
	if (!trimmed || trimmed === '.' || trimmed === '..')
		return undefined;
	if (!/^[a-zA-Z0-9_.-]+$/.test(trimmed)) return undefined;
	return trimmed;
}

export function load_skills_config(): SkillsConfig {
	const path = get_config_path();
	if (!existsSync(path)) return structuredClone(DEFAULT_CONFIG);

	try {
		const raw = readFileSync(path, 'utf-8');
		const parsed = JSON.parse(raw) as Partial<SkillsConfig>;
		const enabled = normalize_enabled_map(parsed.enabled);
		const defaults = parsed.defaults ?? 'all-disabled';
		const profiles = migrate_legacy_enablement_to_default_profile(
			normalize_profiles(parsed.profiles),
			enabled,
			defaults,
		);
		const current_profile = safe_profile_name(
			parsed.current_profile ?? 'default',
		);
		const config: SkillsConfig = {
			version: 3,
			enabled: {},
			defaults: 'all-disabled',
			profiles,
		};
		if (current_profile) config.current_profile = current_profile;
		return config;
	} catch {
		return structuredClone(DEFAULT_CONFIG);
	}
}

export function save_skills_config(config: SkillsConfig): void {
	const path = get_config_path();
	const dir = dirname(path);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}

	const tmp = `${path}.tmp-${Date.now()}`;
	writeFileSync(tmp, JSON.stringify(config, null, '\t') + '\n', {
		mode: 0o600,
	});
	renameSync(tmp, path);
}

export function make_skill_key(name: string, source: string): string {
	return `${name}@${source}`;
}

export function is_skill_enabled(
	config: SkillsConfig,
	key: string,
): boolean {
	if (key in config.enabled) return config.enabled[key];
	return config.defaults === 'all-enabled';
}
