import {
	getAgentDir,
	parseFrontmatter,
	type SkillFrontmatter,
} from '@mariozechner/pi-coding-agent';
import { existsSync, globSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

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

export interface DiscoveredSkill {
	name: string;
	description: string;
	skillPath: string;
	baseDir: string;
	source: string;
	kind: 'managed' | 'external';
	plugin?: PluginSkillSource;
	import_meta?: ImportedSkillMetadata;
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

		const name = frontmatter?.name || basename(dirname(skill_path));
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
		kind: 'managed' | 'external';
		plugin?: PluginSkillSource;
		include_direct_root_skill?: boolean;
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
		const matches = globSync('*/SKILL.md', { cwd: dir });
		for (const match of matches) {
			const full_path = resolve(dir, match);
			const parsed = parse_skill_md(full_path);
			if (parsed) {
				const base_dir = dirname(full_path);
				results.push({
					...parsed,
					skillPath: full_path,
					baseDir: base_dir,
					source: options.source,
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
			kind: 'managed',
		},
	)) {
		skills.push(skill);
	}

	for (const skill of scan_dir_for_skills(
		join(getAgentDir(), 'skills'),
		{
			source: 'pi-native',
			kind: 'managed',
			include_direct_root_skill: false,
		},
	)) {
		skills.push(skill);
	}

	return dedupe_by_skill_path(skills);
}

export function scan_importable_skills(): DiscoveredSkill[] {
	const skills: DiscoveredSkill[] = [];
	const plugins = read_installed_plugins();
	if (!plugins?.plugins) return skills;

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
					kind: 'external',
					plugin,
				});
			}
		}
	}

	return dedupe_by_skill_path(skills);
}

export function scan_all_skills(): DiscoveredSkill[] {
	return [...scan_managed_skills(), ...scan_importable_skills()];
}
