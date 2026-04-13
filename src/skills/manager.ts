import {
	type SkillsConfig,
	is_skill_enabled,
	load_skills_config,
	make_skill_key,
	save_skills_config,
} from './config.js';
import {
	type ImportSkillResult,
	type SyncSkillResult,
	import_external_skill,
	sync_imported_skill,
} from './importer.js';
import {
	type DiscoveredSkill,
	scan_importable_skills,
	scan_managed_skills,
} from './scanner.js';

export interface ManagedSkill extends DiscoveredSkill {
	key: string;
	enabled: boolean;
}

export interface SkillsManager {
	discover(): ManagedSkill[];
	discover_importable(): ManagedSkill[];
	get_enabled_skill_paths(): string[];
	/** Check if a skill should pass through pi's skillsOverride */
	is_enabled_by_skill(name: string, filePath: string): boolean;
	enable(key: string): boolean;
	disable(key: string): boolean;
	toggle(key: string): boolean;
	search(query: string): ManagedSkill[];
	search_importable(query: string): ManagedSkill[];
	set_defaults(policy: 'all-enabled' | 'all-disabled'): void;
	import_skill(
		key_or_name: string,
	): ImportSkillResult & { key: string };
	sync_skill(key_or_name: string): SyncSkillResult & { key: string };
	refresh(): void;
}

function resolve_skill_key(skill: DiscoveredSkill): string {
	return make_skill_key(skill.name, skill.source);
}

function match_skill_by_key_or_name(
	skills: DiscoveredSkill[],
	key_or_name: string,
): DiscoveredSkill {
	const exact_key = skills.find(
		(skill) => resolve_skill_key(skill) === key_or_name,
	);
	if (exact_key) return exact_key;

	const by_name = skills.filter(
		(skill) => skill.name === key_or_name,
	);
	if (by_name.length === 1) {
		return by_name[0]!;
	}
	if (by_name.length > 1) {
		throw new Error(
			`Multiple skills named ${key_or_name}. Use an exact key instead.`,
		);
	}

	throw new Error(`Unknown skill: ${key_or_name}`);
}

export function create_skills_manager(): SkillsManager {
	let config: SkillsConfig = load_skills_config();
	let managed_cache: DiscoveredSkill[] | null = null;
	let importable_cache: DiscoveredSkill[] | null = null;

	function get_managed(): DiscoveredSkill[] {
		if (!managed_cache) {
			managed_cache = scan_managed_skills();
		}
		return managed_cache;
	}

	function get_importable(): DiscoveredSkill[] {
		if (!importable_cache) {
			importable_cache = scan_importable_skills();
		}
		return importable_cache;
	}

	function to_managed(skill: DiscoveredSkill): ManagedSkill {
		const key = resolve_skill_key(skill);
		return {
			...skill,
			key,
			enabled:
				skill.kind === 'managed'
					? is_skill_enabled(config, key)
					: false,
		};
	}

	function get_enabled_managed_skills(): ManagedSkill[] {
		return get_managed()
			.filter((skill) =>
				is_skill_enabled(config, resolve_skill_key(skill)),
			)
			.map(to_managed);
	}

	return {
		discover(): ManagedSkill[] {
			return get_managed().map(to_managed);
		},

		discover_importable(): ManagedSkill[] {
			return get_importable().map(to_managed);
		},

		is_enabled_by_skill(name: string, filePath: string): boolean {
			const discovered = get_managed();
			const match = discovered.find((s) => s.skillPath === filePath);
			if (match) {
				return is_skill_enabled(config, resolve_skill_key(match));
			}

			const by_name = discovered.find((s) => s.name === name);
			if (by_name) {
				return is_skill_enabled(config, resolve_skill_key(by_name));
			}

			// Unknown skill sources should remain enabled so pi's native
			// discovery keeps working for project and other default locations.
			return true;
		},

		get_enabled_skill_paths(): string[] {
			return get_enabled_managed_skills().map(
				(skill) => skill.baseDir,
			);
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

		search_importable(query: string): ManagedSkill[] {
			const q = query.toLowerCase();
			return this.discover_importable().filter(
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

		import_skill(key_or_name: string) {
			const skill = match_skill_by_key_or_name(
				get_importable(),
				key_or_name,
			);
			const result = import_external_skill(skill);
			const managed_key = make_skill_key(skill.name, 'pi-native');
			config.enabled[managed_key] = true;
			save_skills_config(config);
			this.refresh();
			return {
				...result,
				key: managed_key,
			};
		},

		sync_skill(key_or_name: string) {
			const skill = match_skill_by_key_or_name(
				get_managed(),
				key_or_name,
			);
			const result = sync_imported_skill(skill);
			this.refresh();
			return {
				...result,
				key: resolve_skill_key(skill),
			};
		},

		refresh(): void {
			managed_cache = null;
			importable_cache = null;
			config = load_skills_config();
		},
	};
}
