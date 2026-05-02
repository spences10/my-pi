import { type SettingItem } from '@mariozechner/pi-tui';
import type { ManagedSkill, SkillProfile } from './manager.js';

export const ENABLED = '● enabled';
export const DISABLED = '○ disabled';
export const SYNC = '↻ sync';
export const IMPORTED_LABEL = '✓ imported';

export interface ImportableSkillState {
	label: string;
	detail: string;
	action: 'import' | 'sync' | null;
}

export function sort_skills(skills: ManagedSkill[]): ManagedSkill[] {
	return [...skills].sort((a, b) => {
		const by_name = a.name.localeCompare(b.name);
		if (by_name !== 0) return by_name;
		const by_source = a.source.localeCompare(b.source);
		if (by_source !== 0) return by_source;
		return a.key.localeCompare(b.key);
	});
}

export function find_matching_imported_skill(
	managed_skills: ManagedSkill[],
	skill: ManagedSkill,
): ManagedSkill | undefined {
	const exact_match = managed_skills.find(
		(candidate) =>
			candidate.import_meta?.source === skill.source &&
			(candidate.import_meta.upstream_skill_path ===
				skill.skillPath ||
				candidate.import_meta.upstream_base_dir === skill.baseDir),
	);
	if (exact_match) return exact_match;

	return managed_skills.find(
		(candidate) =>
			candidate.import_meta?.source === skill.source &&
			candidate.name === skill.name,
	);
}

export function get_importable_state(
	managed_skills: ManagedSkill[],
	skill: ManagedSkill,
): ImportableSkillState {
	const imported = find_matching_imported_skill(
		managed_skills,
		skill,
	);
	if (imported?.import_meta) {
		const version_changed = Boolean(
			skill.plugin?.version &&
			imported.import_meta.upstream_version &&
			skill.plugin.version !== imported.import_meta.upstream_version,
		);
		const sha_changed = Boolean(
			skill.plugin?.gitCommitSha &&
			imported.import_meta.upstream_git_commit_sha &&
			skill.plugin.gitCommitSha !==
				imported.import_meta.upstream_git_commit_sha,
		);

		if (version_changed || sha_changed) {
			return {
				label: 'sync',
				detail: 'Press Enter to sync the imported copy and reload',
				action: 'sync',
			};
		}

		return {
			label: 'imported',
			detail: `Already imported to ${imported.baseDir}`,
			action: null,
		};
	}

	const managed_conflict = managed_skills.find(
		(candidate) => candidate.name === skill.name,
	);
	if (managed_conflict) {
		return {
			label: 'managed',
			detail: `Already managed at ${managed_conflict.baseDir}`,
			action: null,
		};
	}

	return {
		label: 'import',
		detail: 'Press Enter to import into pi-native skills and reload',
		action: 'import',
	};
}

export function to_setting_item(skill: ManagedSkill): SettingItem {
	const detail_lines = [
		`${skill.source} • ${skill.key}`,
		skill.description,
		skill.baseDir,
	];
	if (skill.import_meta?.upstream_version) {
		detail_lines.push(
			`upstream: ${skill.import_meta.upstream_version}${skill.import_meta.upstream_git_commit_sha ? ` • ${skill.import_meta.upstream_git_commit_sha.slice(0, 12)}` : ''}`,
		);
	}

	return {
		id: skill.key,
		label: skill.name,
		description: detail_lines.join('\n'),
		currentValue: skill.enabled ? ENABLED : DISABLED,
		values: [ENABLED, DISABLED],
	};
}

export function to_importable_setting_item(
	managed_skills: ManagedSkill[],
	skill: ManagedSkill,
): SettingItem {
	const state = get_importable_state(managed_skills, skill);
	const detail_lines = [
		`${skill.source} • ${skill.key}`,
		skill.description,
		skill.baseDir,
	];
	if (skill.plugin?.version) {
		detail_lines.push(
			`plugin: ${skill.plugin.version}${skill.plugin.gitCommitSha ? ` • ${skill.plugin.gitCommitSha.slice(0, 12)}` : ''}`,
		);
	}

	if (state.action === 'import') {
		return {
			id: skill.key,
			label: skill.name,
			description: detail_lines.join('\n'),
			currentValue: DISABLED,
			values: [ENABLED, DISABLED],
		};
	}

	if (state.action === 'sync') {
		detail_lines.push('enter to sync');
		return {
			id: skill.key,
			label: skill.name,
			description: detail_lines.join('\n'),
			currentValue: SYNC,
			values: [SYNC],
		};
	}

	detail_lines.push(state.detail);
	return {
		id: skill.key,
		label: skill.name,
		description: detail_lines.join('\n'),
		currentValue: IMPORTED_LABEL,
	};
}

export function sets_equal(
	a: ReadonlySet<string>,
	b: ReadonlySet<string>,
): boolean {
	if (a.size !== b.size) return false;
	for (const value of a) {
		if (!b.has(value)) return false;
	}
	return true;
}

export function skill_status(skill: ManagedSkill): string {
	if (skill.kind === 'external') return 'importable';
	return skill.enabled ? 'enabled' : 'disabled';
}

export function format_skill_detail(skill: ManagedSkill): string {
	const lines = [
		`# ${skill.name}`,
		'',
		`Status: ${skill_status(skill)}`,
		`Source: ${skill.source}`,
		`Key: ${skill.key}`,
		`Kind: ${skill.kind}`,
		'',
		skill.description,
		'',
		`Base directory: ${skill.baseDir}`,
		`Skill file: ${skill.skillPath}`,
	];

	if (skill.plugin) {
		lines.push(
			'',
			'Plugin',
			`- ID: ${skill.plugin.pluginId}`,
			`- Version: ${skill.plugin.version}`,
			`- Install path: ${skill.plugin.installPath}`,
		);
		if (skill.plugin.gitCommitSha) {
			lines.push(`- Commit: ${skill.plugin.gitCommitSha}`);
		}
	}

	if (skill.import_meta) {
		lines.push(
			'',
			'Import metadata',
			`- Upstream source: ${skill.import_meta.source}`,
			`- Imported at: ${skill.import_meta.imported_at}`,
			`- Last synced at: ${skill.import_meta.last_synced_at}`,
			`- Upstream path: ${skill.import_meta.upstream_skill_path}`,
		);
		if (skill.import_meta.upstream_version) {
			lines.push(
				`- Upstream version: ${skill.import_meta.upstream_version}`,
			);
		}
		if (skill.import_meta.upstream_git_commit_sha) {
			lines.push(
				`- Upstream commit: ${skill.import_meta.upstream_git_commit_sha}`,
			);
		}
	}

	return lines.join('\n');
}

export function format_skill_list(skills: ManagedSkill[]): string {
	if (skills.length === 0) return 'No skills found.';
	return sort_skills(skills)
		.map(
			(skill) =>
				`${skill_status(skill).padEnd(10)} ${skill.name} (${skill.key})`,
		)
		.join('\n');
}

export function find_skill(
	skills: ManagedSkill[],
	key_or_name: string,
): ManagedSkill {
	const query = key_or_name.trim();
	const exact_key = skills.find((skill) => skill.key === query);
	if (exact_key) return exact_key;

	const exact_name = skills.filter((skill) => skill.name === query);
	if (exact_name.length === 1) return exact_name[0]!;
	if (exact_name.length > 1) {
		throw new Error(
			`Multiple skills named ${query}. Use an exact key instead.`,
		);
	}

	const lower = query.toLowerCase();
	const fuzzy = skills.filter(
		(skill) =>
			skill.key.toLowerCase() === lower ||
			skill.name.toLowerCase() === lower,
	);
	if (fuzzy.length === 1) return fuzzy[0]!;
	if (fuzzy.length > 1) {
		throw new Error(
			`Multiple skills matched ${query}. Use an exact key instead.`,
		);
	}

	throw new Error(`Unknown skill: ${query}`);
}

export function profile_description(profile: SkillProfile): string {
	const parts = [profile.active ? 'active' : 'inactive'];
	if (profile.extends.length) {
		parts.push(`extends ${profile.extends.join(', ')}`);
	}
	parts.push(`${profile.include.length} include`);
	parts.push(`${profile.exclude.length} exclude`);
	return parts.join(' • ');
}

export function format_profile_detail(profile: SkillProfile): string {
	const lines = [
		`# ${profile.name}`,
		'',
		`Status: ${profile.active ? 'active' : 'inactive'}`,
	];
	if (profile.description) {
		lines.push(`Description: ${profile.description}`);
	}
	if (profile.extends.length) {
		lines.push(`Extends: ${profile.extends.join(', ')}`);
	}
	lines.push('', 'Include patterns:');
	lines.push(
		...(profile.include.length
			? profile.include.map((p) => `- ${p}`)
			: ['- none']),
	);
	lines.push('', 'Exclude patterns:');
	lines.push(
		...(profile.exclude.length
			? profile.exclude.map((p) => `- ${p}`)
			: ['- none']),
	);
	return lines.join('\n');
}
