import { type DiscoveredSkill, scan_all_skills } from './scanner.js';
import {
	type SkillsConfig,
	is_skill_enabled,
	load_skills_config,
	make_skill_key,
	save_skills_config,
} from './config.js';

export interface ManagedSkill extends DiscoveredSkill {
	key: string;
	enabled: boolean;
}

export interface SkillsManager {
	discover(): ManagedSkill[];
	get_enabled_skill_paths(): string[];
	/** Check if a skill should pass through skillsOverride (pi's native loading) */
	is_enabled_by_skill(name: string, filePath: string): boolean;
	enable(key: string): boolean;
	disable(key: string): boolean;
	toggle(key: string): boolean;
	search(query: string): ManagedSkill[];
	set_defaults(policy: 'all-enabled' | 'all-disabled'): void;
	refresh(): void;
}

export function create_skills_manager(): SkillsManager {
	let config: SkillsConfig = load_skills_config();
	let cache: DiscoveredSkill[] | null = null;

	function get_discovered(): DiscoveredSkill[] {
		if (!cache) {
			cache = scan_all_skills();
		}
		return cache;
	}

	function to_managed(skill: DiscoveredSkill): ManagedSkill {
		const key = make_skill_key(skill.name, skill.source);
		return {
			...skill,
			key,
			enabled: is_skill_enabled(config, key),
		};
	}

	return {
		discover(): ManagedSkill[] {
			return get_discovered().map(to_managed);
		},

		is_enabled_by_skill(name: string, filePath: string): boolean {
			// Try to find this skill in our discovered set by filePath
			const discovered = get_discovered();
			const match = discovered.find((s) => s.skillPath === filePath);
			if (match) {
				return is_skill_enabled(config, make_skill_key(match.name, match.source));
			}
			// Skill not in our discovered set (e.g. from pi's own paths)
			// Fall back to checking by name with a generic source
			const by_name = discovered.find((s) => s.name === name);
			if (by_name) {
				return is_skill_enabled(config, make_skill_key(by_name.name, by_name.source));
			}
			// Unknown skill — respect defaults
			return config.defaults === 'all-enabled';
		},

		get_enabled_skill_paths(): string[] {
			return get_discovered()
				.filter((s) => is_skill_enabled(config, make_skill_key(s.name, s.source)))
				.map((s) => s.baseDir);
		},

		enable(key: string): boolean {
			config.enabled[key] = true;
			save_skills_config(config);
			return true;
		},

		disable(key: string): boolean {
			config.enabled[key] = false;
			save_skills_config(config);
			return false;
		},

		toggle(key: string): boolean {
			const current = is_skill_enabled(config, key);
			config.enabled[key] = !current;
			save_skills_config(config);
			return !current;
		},

		search(query: string): ManagedSkill[] {
			const q = query.toLowerCase();
			return this.discover().filter(
				(s) =>
					s.name.toLowerCase().includes(q) ||
					s.description.toLowerCase().includes(q) ||
					s.source.toLowerCase().includes(q),
			);
		},

		set_defaults(policy: 'all-enabled' | 'all-disabled'): void {
			config.defaults = policy;
			save_skills_config(config);
		},

		refresh(): void {
			cache = null;
			config = load_skills_config();
		},
	};
}
