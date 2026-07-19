import {
	getAgentDir,
	parseFrontmatter,
	type SkillFrontmatter,
} from '@earendil-works/pi-coding-agent';
import {
	existsSync,
	globSync,
	readFileSync,
	statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, parse, resolve } from 'node:path';

export const IMPORT_METADATA_FILE = '.my-pi-source.json';

export interface InstalledPlugin {
	scope: string;
	installPath: string;
	version: string;
	installedAt?: string;
	lastUpdated?: string;
	gitCommitSha?: string;
}

interface InstalledPluginsFile {
	version: number;
	plugins: Record<string, InstalledPlugin[]>;
}

export interface ImportedSkillMetadata {
	version: number;
	source: string;
	upstream_skill_path: string;
	upstream_base_dir: string;
	upstream_install_path?: string;
	upstream_version?: string;
	upstream_git_commit_sha?: string;
	imported_at: string;
	last_synced_at: string;
	imported_hash: string;
	upstream_hash: string;
}

export interface PluginSkillSource {
	pluginId: string;
	installPath: string;
	version: string;
	gitCommitSha?: string;
}

export type SkillScope = 'global' | 'project' | 'plugin';

export interface DiscoveredSkill {
	name: string;
	description: string;
	skillPath: string;
	baseDir: string;
	source: string;
	scope: SkillScope;
	kind: 'managed' | 'external';
	plugin?: PluginSkillSource;
	import_meta?: ImportedSkillMetadata;
}

export interface ImportableSkill extends DiscoveredSkill {
	scope: 'plugin';
	kind: 'external';
	plugin: PluginSkillSource;
}

export interface ImportedSkill extends DiscoveredSkill {
	kind: 'managed';
	import_meta: ImportedSkillMetadata;
}

export function is_importable_skill(
	skill: DiscoveredSkill,
): skill is ImportableSkill {
	return (
		skill.kind === 'external' &&
		skill.scope === 'plugin' &&
		skill.plugin !== undefined
	);
}

export function is_imported_skill(
	skill: DiscoveredSkill,
): skill is ImportedSkill {
	return skill.kind === 'managed' && skill.import_meta !== undefined;
}

function read_installed_plugins(): InstalledPluginsFile | null {
	const path = join(
		homedir(),
		'.claude',
		'plugins',
		'installed_plugins.json',
	);
	if (!existsSync(path)) return null;

	try {
		return JSON.parse(
			readFileSync(path, 'utf-8'),
		) as InstalledPluginsFile;
	} catch {
		return null;
	}
}

function parse_skill_md(
	skill_path: string,
): { name: string; description: string } | null {
	try {
		const content = readFileSync(skill_path, 'utf-8');
		const { frontmatter } =
			parseFrontmatter<SkillFrontmatter>(content);
		const description = frontmatter?.description;
		if (!description) return null;

		const name =
			frontmatter?.name ||
			(basename(skill_path) === 'SKILL.md'
				? basename(dirname(skill_path))
				: parse(skill_path).name);
		return { name, description: description.trim() };
	} catch {
		return null;
	}
}

function read_import_metadata(
	base_dir: string,
): ImportedSkillMetadata | undefined {
	const metadata_path = join(base_dir, IMPORT_METADATA_FILE);
	if (!existsSync(metadata_path)) return undefined;

	try {
		return JSON.parse(
			readFileSync(metadata_path, 'utf-8'),
		) as ImportedSkillMetadata;
	} catch {
		return undefined;
	}
}

function scan_dir_for_skills(
	dir: string,
	options: {
		source: string;
		scope: SkillScope;
		kind: 'managed' | 'external';
		plugin?: PluginSkillSource;
		include_direct_root_skill?: boolean;
		include_root_markdown_skills?: boolean;
		exclude_matches?: (match: string) => boolean;
	},
): DiscoveredSkill[] {
	if (!existsSync(dir)) return [];

	const results: DiscoveredSkill[] = [];
	const direct = join(dir, 'SKILL.md');
	const include_direct_root_skill =
		options.include_direct_root_skill ?? true;

	if (include_direct_root_skill && existsSync(direct)) {
		const parsed = parse_skill_md(direct);
		if (parsed) {
			results.push({
				...parsed,
				skillPath: direct,
				baseDir: dir,
				source: options.source,
				scope: options.scope,
				kind: options.kind,
				plugin: options.plugin,
				import_meta:
					options.kind === 'managed'
						? read_import_metadata(dir)
						: undefined,
			});
		}
		return results;
	}

	try {
		const matches = globSync('**/SKILL.md', { cwd: dir });
		if (options.include_root_markdown_skills) {
			matches.push(
				...globSync('*.md', { cwd: dir }).filter(
					(match) => match !== 'SKILL.md',
				),
			);
		}
		for (const match of matches
			.filter((candidate) => !options.exclude_matches?.(candidate))
			.sort((a, b) => a.localeCompare(b))) {
			const full_path = resolve(dir, match);
			const parsed = parse_skill_md(full_path);
			if (parsed) {
				const base_dir = dirname(full_path);
				results.push({
					...parsed,
					skillPath: full_path,
					baseDir: base_dir,
					source: options.source,
					scope: options.scope,
					kind: options.kind,
					plugin: options.plugin,
					import_meta:
						options.kind === 'managed'
							? read_import_metadata(base_dir)
							: undefined,
				});
			}
		}
	} catch {
		// skip inaccessible dirs
	}

	return results;
}

function dedupe_by_skill_path(
	skills: DiscoveredSkill[],
): DiscoveredSkill[] {
	const seen = new Set<string>();
	const deduped: DiscoveredSkill[] = [];

	for (const skill of skills) {
		if (seen.has(skill.skillPath)) continue;
		seen.add(skill.skillPath);
		deduped.push(skill);
	}

	return deduped;
}

export function scan_managed_skills(): DiscoveredSkill[] {
	const skills: DiscoveredSkill[] = [];

	for (const skill of scan_dir_for_skills(
		join(homedir(), '.claude', 'skills'),
		{
			source: 'user-local',
			scope: 'global',
			kind: 'managed',
		},
	)) {
		skills.push(skill);
	}

	for (const skill of scan_dir_for_skills(
		join(getAgentDir(), 'skills'),
		{
			source: 'pi-native',
			scope: 'global',
			kind: 'managed',
			include_direct_root_skill: false,
			include_root_markdown_skills: true,
		},
	)) {
		skills.push(skill);
	}

	return dedupe_by_skill_path(skills);
}

function parent_dir(path: string): string | null {
	const parsed = parse(path);
	const parent = dirname(path);
	return parent === path || parent === parsed.root ? null : parent;
}

function is_directory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function project_roots(cwd: string): string[] {
	const roots: string[] = [];
	let current = resolve(cwd);
	while (true) {
		roots.push(current);
		if (is_directory(join(current, '.git'))) break;
		const parent = parent_dir(current);
		if (!parent) break;
		current = parent;
	}
	return roots;
}

export function scan_imported_skills(): ImportedSkill[] {
	return scan_managed_skills().filter(is_imported_skill);
}

export function scan_project_skills(
	cwd = process.cwd(),
): DiscoveredSkill[] {
	const skills: DiscoveredSkill[] = [];
	for (const root of project_roots(cwd)) {
		for (const skill of scan_dir_for_skills(join(root, '.agents'), {
			source: 'project:.agents',
			scope: 'project',
			kind: 'managed',
			include_direct_root_skill: false,
			exclude_matches: (match) => match.startsWith('skills/'),
		})) {
			skills.push(skill);
		}
		for (const skill of scan_dir_for_skills(
			join(root, '.agents', 'skills'),
			{
				source: 'project:.agents/skills',
				scope: 'project',
				kind: 'managed',
				include_direct_root_skill: false,
			},
		)) {
			skills.push(skill);
		}
		for (const skill of scan_dir_for_skills(
			join(root, '.pi', 'skills'),
			{
				source: 'project:.pi/skills',
				scope: 'project',
				kind: 'managed',
				include_direct_root_skill: false,
				include_root_markdown_skills: true,
			},
		)) {
			skills.push(skill);
		}
	}
	return dedupe_by_skill_path(skills);
}

export function scan_importable_skills(): ImportableSkill[] {
	const skills: DiscoveredSkill[] = [];
	const plugins = read_installed_plugins();
	if (!plugins?.plugins) return [];

	for (const [plugin_id, entries] of Object.entries(
		plugins.plugins,
	)) {
		const entry = entries[0];
		if (!entry?.installPath || !existsSync(entry.installPath))
			continue;

		const source = `plugin:${plugin_id}`;
		const plugin: PluginSkillSource = {
			pluginId: plugin_id,
			installPath: entry.installPath,
			version: entry.version,
			gitCommitSha: entry.gitCommitSha,
		};

		for (const skill of scan_dir_for_skills(
			join(entry.installPath, 'skills'),
			{
				source,
				scope: 'plugin',
				kind: 'external',
				plugin,
			},
		)) {
			skills.push(skill);
		}

		for (const skill of scan_dir_for_skills(
			join(entry.installPath, '.pi', 'skills'),
			{
				source,
				scope: 'plugin',
				kind: 'external',
				plugin,
			},
		)) {
			skills.push(skill);
		}

		const direct_root_skill = join(entry.installPath, 'SKILL.md');
		if (existsSync(direct_root_skill)) {
			const parsed = parse_skill_md(direct_root_skill);
			if (parsed) {
				skills.push({
					...parsed,
					skillPath: direct_root_skill,
					baseDir: entry.installPath,
					source,
					scope: 'plugin',
					kind: 'external',
					plugin,
				});
			}
		}
	}

	return dedupe_by_skill_path(skills).filter(is_importable_skill);
}

export function scan_all_skills(
	cwd = process.cwd(),
): DiscoveredSkill[] {
	return [
		...scan_managed_skills(),
		...scan_project_skills(cwd),
		...scan_importable_skills(),
	];
}
