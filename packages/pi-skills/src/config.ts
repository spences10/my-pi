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
	enabled: Record<string, boolean>;
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
	version: 2,
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

	return {
		...(description ? { description } : {}),
		...(extends_value ? { extends: extends_value } : {}),
		...(string_array(parsed.include)
			? { include: string_array(parsed.include) }
			: {}),
		...(string_array(parsed.exclude)
			? { exclude: string_array(parsed.exclude) }
			: {}),
	};
}

function normalize_profiles(
	value: unknown,
): Record<string, SkillProfileConfig> {
	if (!value || typeof value !== 'object') {
		return { ...DEFAULT_PROFILES };
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
		: { ...DEFAULT_PROFILES };
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
		const profiles = normalize_profiles(parsed.profiles);
		const current_profile = safe_profile_name(
			parsed.current_profile ?? 'default',
		);
		return {
			version: parsed.version ?? 2,
			enabled: parsed.enabled ?? {},
			defaults: parsed.defaults ?? 'all-enabled',
			...(current_profile
				? { current_profile: current_profile }
				: {}),
			profiles,
		};
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
