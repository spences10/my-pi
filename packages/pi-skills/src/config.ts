import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface SkillsConfig {
	version: number;
	enabled: Record<string, boolean>;
	defaults: 'all-enabled' | 'all-disabled';
}

const DEFAULT_CONFIG: SkillsConfig = {
	version: 1,
	enabled: {},
	defaults: 'all-disabled',
};

export function get_config_path(): string {
	const xdg =
		process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
	return join(xdg, 'my-pi', 'skills.json');
}

export function load_skills_config(): SkillsConfig {
	const path = get_config_path();
	if (!existsSync(path)) return { ...DEFAULT_CONFIG };

	try {
		const raw = readFileSync(path, 'utf-8');
		const parsed = JSON.parse(raw) as Partial<SkillsConfig>;
		return {
			version: parsed.version ?? 1,
			enabled: parsed.enabled ?? {},
			defaults: parsed.defaults ?? 'all-enabled',
		};
	} catch {
		return { ...DEFAULT_CONFIG };
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
