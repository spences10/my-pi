import { get_github_repos } from '@spences10/pi-git-remote';
import { existsSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import {
	type SkillContextRule,
	type SkillDefaultPolicy,
	type SkillProfileConfig,
	type SkillsConfig,
	is_skill_enabled,
	load_skills_config,
	make_skill_key,
	safe_profile_name,
	save_skills_config,
} from './config.js';
import {
	type DiscoveredSkill,
	scan_managed_skills,
	scan_project_skills,
} from './scanner.js';
export interface DeleteSkillResult {
	skillDir: string;
}

export const SKILLS_PROFILE_ENV = 'MY_PI_SKILLS_PROFILE';

export interface ManagedSkill extends DiscoveredSkill {
	key: string;
	enabled: boolean;
}

export interface SkillProfile {
	name: string;
	description?: string;
	extends: string[];
	include: string[];
	exclude: string[];
	active: boolean;
}

export interface SkillsManager {
	discover(): ManagedSkill[];
	get_enabled_skill_paths(): string[];
	/** Check if a skill should pass through pi's skillsOverride */
	is_enabled_by_skill(name: string, filePath: string): boolean;
	set_cwd(cwd: string): void;
	enable(key: string): boolean;
	disable(key: string): boolean;
	toggle(key: string): boolean;
	search(query: string): ManagedSkill[];
	set_defaults(policy: SkillDefaultPolicy): void;
	get_active_profile(): string;
	list_profiles(): SkillProfile[];
	use_profile(name: string): void;
	create_profile(
		name: string,
		options?: { description?: string; extends?: string[] },
	): SkillProfile;
	include_in_profile(profile: string, pattern: string): void;
	exclude_from_profile(profile: string, pattern: string): void;
	delete_skill(
		key_or_name: string,
	): DeleteSkillResult & { key: string };
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

function normalize_extends(
	value: SkillProfileConfig['extends'],
): string[] {
	if (!value) return [];
	return Array.isArray(value) ? value : [value];
}

function unique_push(values: string[], value: string): void {
	if (!values.includes(value)) values.push(value);
}

function remove_value(
	values: string[] | undefined,
	value: string,
): string[] {
	return (values ?? []).filter((item) => item !== value);
}

function escape_regex(value: string): string {
	return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function normalize_match_path(value: string): string {
	if (value.startsWith('~/')) {
		return resolve(process.env.HOME ?? '', value.slice(2));
	}
	return value;
}

function glob_matches(pattern: string, value: string): boolean {
	const regex = new RegExp(
		`^${normalize_match_path(pattern).split('*').map(escape_regex).join('.*')}$`,
		'i',
	);
	return regex.test(normalize_match_path(value));
}

function profile_pattern_matches(
	pattern: string,
	skill: DiscoveredSkill,
): boolean {
	const key = resolve_skill_key(skill);
	return [
		key,
		skill.name,
		skill.source,
		skill.skillPath,
		skill.baseDir,
	].some((value) => glob_matches(pattern, value));
}

function require_profile_name(name: string): string {
	const normalized = safe_profile_name(name);
	if (!normalized)
		throw new Error(`Invalid skill profile name: ${name}`);
	return normalized;
}

function string_values(
	value: string | string[] | undefined,
): string[] {
	if (!value) return [];
	return Array.isArray(value) ? value : [value];
}

export function create_skills_manager(
	options: { cwd?: string; project_skills_enabled?: boolean } = {},
): SkillsManager {
	let config: SkillsConfig = load_skills_config();
	let cwd = options.cwd ?? process.cwd();
	let project_skills_enabled = options.project_skills_enabled ?? true;
	let managed_cache: DiscoveredSkill[] | null = null;

	function get_managed(): DiscoveredSkill[] {
		if (!managed_cache) {
			managed_cache = [
				...scan_managed_skills(),
				...scan_project_skills(cwd),
			];
		}
		return managed_cache;
	}

	function context_matches(
		rule: SkillContextRule,
		github_repos: string[],
	): boolean {
		const cwd_matches = string_values(rule.when.cwd).some((pattern) =>
			glob_matches(pattern, cwd),
		);
		const github_orgs = string_values(rule.when.github_org).map(
			(org) => org.toLowerCase(),
		);
		const github_repos_to_match = string_values(
			rule.when.github_repo,
		).map((repo) => repo.toLowerCase());
		const github_org_matches = github_orgs.length
			? github_repos.some((repo) =>
					github_orgs.includes(repo.split('/')[0] ?? ''),
				)
			: false;
		const github_repo_matches = github_repos_to_match.length
			? github_repos.some((repo) =>
					github_repos_to_match.includes(repo),
				)
			: false;
		return cwd_matches || github_org_matches || github_repo_matches;
	}

	function get_active_profile(): string {
		const from_env = process.env[SKILLS_PROFILE_ENV]?.trim();
		if (from_env) return require_profile_name(from_env);
		const github_repos = get_github_repos(cwd);
		for (const context of config.contexts) {
			if (!config.profiles[context.profile]) continue;
			if (context_matches(context, github_repos)) {
				return context.profile;
			}
		}
		return config.current_profile ?? 'default';
	}

	function resolve_profile_rules(
		name: string,
		seen = new Set<string>(),
	): Array<{ pattern: string; enabled: boolean }> {
		const profile = config.profiles[name];
		if (!profile || seen.has(name)) return [];
		seen.add(name);

		const rules: Array<{ pattern: string; enabled: boolean }> = [];
		for (const parent of normalize_extends(profile.extends)) {
			rules.push(...resolve_profile_rules(parent, seen));
		}
		for (const pattern of profile.include ?? []) {
			rules.push({ pattern, enabled: true });
		}
		for (const pattern of profile.exclude ?? []) {
			rules.push({ pattern, enabled: false });
		}
		return rules;
	}

	function apply_profile_rules(
		initial: boolean,
		skill: DiscoveredSkill,
	): boolean {
		let enabled = initial;
		for (const rule of resolve_profile_rules(get_active_profile())) {
			if (profile_pattern_matches(rule.pattern, skill)) {
				enabled = rule.enabled;
			}
		}
		return enabled;
	}

	function is_effectively_enabled(skill: DiscoveredSkill): boolean {
		if (skill.scope === 'project' && !project_skills_enabled)
			return false;
		const initial =
			skill.scope === 'project'
				? true
				: is_skill_enabled(config, resolve_skill_key(skill));
		return apply_profile_rules(initial, skill);
	}

	function get_or_create_profile(name: string): SkillProfileConfig {
		const normalized = require_profile_name(name);
		config.profiles[normalized] ??= {};
		return config.profiles[normalized]!;
	}

	function to_profile(name: string): SkillProfile {
		const profile = config.profiles[name] ?? {};
		const result: SkillProfile = {
			name,
			extends: normalize_extends(profile.extends),
			include: [...(profile.include ?? [])],
			exclude: [...(profile.exclude ?? [])],
			active: name === get_active_profile(),
		};
		if (profile.description) result.description = profile.description;
		return result;
	}

	function set_profile_skill_enabled(
		key: string,
		enabled: boolean,
	): boolean {
		const profile = get_or_create_profile(get_active_profile());
		if (enabled) {
			profile.exclude = remove_value(profile.exclude, key);
			profile.include ??= [];
			unique_push(profile.include, key);
		} else {
			profile.include = remove_value(profile.include, key);
			profile.exclude ??= [];
			unique_push(profile.exclude, key);
		}
		save_skills_config(config);
		return enabled;
	}

	function to_managed(skill: DiscoveredSkill): ManagedSkill {
		const key = resolve_skill_key(skill);
		return {
			...skill,
			key,
			enabled:
				skill.kind === 'managed'
					? is_effectively_enabled(skill)
					: false,
		};
	}

	function needs_explicit_skill_path(
		skill: DiscoveredSkill,
	): boolean {
		return (
			skill.source === 'user-local' ||
			skill.source === 'project:.agents' ||
			skill.source === 'project:.agents/skills'
		);
	}

	function get_enabled_managed_skills(): ManagedSkill[] {
		return get_managed()
			.filter(is_effectively_enabled)
			.map(to_managed);
	}

	return {
		discover(): ManagedSkill[] {
			return get_managed().map(to_managed);
		},

		is_enabled_by_skill(name: string, filePath: string): boolean {
			const discovered = get_managed();
			const match = discovered.find((s) => s.skillPath === filePath);
			if (match) return is_effectively_enabled(match);

			const by_name = discovered.find((s) => s.name === name);
			if (by_name) return is_effectively_enabled(by_name);

			// Unknown skill sources should remain enabled by default so pi's
			// native discovery keeps working for package and explicit skills.
			return apply_profile_rules(true, {
				name,
				description: '',
				skillPath: filePath,
				baseDir: dirname(filePath),
				source: 'pi-native',
				scope: 'global',
				kind: 'managed',
			});
		},

		set_cwd(next_cwd: string): void {
			const resolved = resolve(next_cwd);
			if (resolved === cwd) return;
			cwd = resolved;
			managed_cache = null;
		},

		get_enabled_skill_paths(): string[] {
			return get_enabled_managed_skills()
				.filter(needs_explicit_skill_path)
				.map((skill) => skill.skillPath);
		},

		enable(key: string): boolean {
			return set_profile_skill_enabled(key, true);
		},

		disable(key: string): boolean {
			return set_profile_skill_enabled(key, false);
		},

		toggle(key: string): boolean {
			const skill = get_managed().find(
				(candidate) => resolve_skill_key(candidate) === key,
			);
			const current = skill
				? is_effectively_enabled(skill)
				: is_skill_enabled(config, key);
			return set_profile_skill_enabled(key, !current);
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

		set_defaults(policy: SkillDefaultPolicy): void {
			const profile = get_or_create_profile(get_active_profile());
			profile.include = remove_value(profile.include, '*');
			profile.exclude = remove_value(profile.exclude, '*');
			if (policy === 'all-enabled') {
				profile.include ??= [];
				profile.include.unshift('*');
			}
			config.defaults = 'all-disabled';
			save_skills_config(config);
		},

		get_active_profile(): string {
			return get_active_profile();
		},

		list_profiles(): SkillProfile[] {
			return Object.keys(config.profiles)
				.sort((a, b) => a.localeCompare(b))
				.map(to_profile);
		},

		use_profile(name: string): void {
			const normalized = require_profile_name(name);
			if (!config.profiles[normalized]) {
				throw new Error(`Unknown skill profile: ${normalized}`);
			}
			config.current_profile = normalized;
			save_skills_config(config);
		},

		create_profile(name, options = {}): SkillProfile {
			const normalized = require_profile_name(name);
			if (config.profiles[normalized]) {
				throw new Error(
					`Skill profile already exists: ${normalized}`,
				);
			}
			const profile: SkillProfileConfig = {
				include: [],
				exclude: [],
			};
			if (options.description)
				profile.description = options.description;
			if (options.extends?.length) profile.extends = options.extends;
			config.profiles[normalized] = profile;
			save_skills_config(config);
			return to_profile(normalized);
		},

		include_in_profile(profile_name: string, pattern: string): void {
			const profile = get_or_create_profile(profile_name);
			const normalized = pattern.trim();
			if (!normalized) throw new Error('Profile pattern is required');
			profile.exclude = remove_value(profile.exclude, normalized);
			profile.include ??= [];
			unique_push(profile.include, normalized);
			save_skills_config(config);
		},

		exclude_from_profile(
			profile_name: string,
			pattern: string,
		): void {
			const profile = get_or_create_profile(profile_name);
			const normalized = pattern.trim();
			if (!normalized) throw new Error('Profile pattern is required');
			profile.include = remove_value(profile.include, normalized);
			profile.exclude ??= [];
			unique_push(profile.exclude, normalized);
			save_skills_config(config);
		},

		delete_skill(key_or_name: string) {
			const skill = match_skill_by_key_or_name(
				get_managed(),
				key_or_name,
			);
			if (!existsSync(skill.baseDir)) {
				throw new Error(
					`Skill directory no longer exists: ${skill.baseDir}`,
				);
			}
			if (!existsSync(skill.skillPath)) {
				throw new Error(
					`Skill file no longer exists: ${skill.skillPath}`,
				);
			}
			const skill_dir = resolve(skill.baseDir);
			const skill_file = resolve(skill.skillPath);
			const relative_skill_path = relative(skill_dir, skill_file);
			if (
				!relative_skill_path ||
				relative_skill_path.startsWith('..') ||
				isAbsolute(relative_skill_path)
			) {
				throw new Error(
					`Refusing to delete unsafe skill path: ${skill.baseDir}`,
				);
			}
			const key = resolve_skill_key(skill);
			rmSync(skill_dir, { recursive: true, force: true });
			for (const profile of Object.values(config.profiles)) {
				profile.include = remove_value(profile.include, key);
				profile.exclude = remove_value(profile.exclude, key);
			}
			save_skills_config(config);
			this.refresh();
			return {
				skillDir: skill_dir,
				key,
			};
		},

		refresh(): void {
			managed_cache = null;
			config = load_skills_config();
			project_skills_enabled =
				options.project_skills_enabled ?? project_skills_enabled;
		},
	};
}
