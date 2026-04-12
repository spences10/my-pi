import { existsSync, globSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import {
	parseFrontmatter,
	type SkillFrontmatter,
} from '@mariozechner/pi-coding-agent';

export interface DiscoveredSkill {
	name: string;
	description: string;
	skillPath: string;
	baseDir: string;
	source: string;
}

interface InstalledPlugin {
	scope: string;
	installPath: string;
	version: string;
}

interface InstalledPluginsFile {
	version: number;
	plugins: Record<string, InstalledPlugin[]>;
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

function scan_dir_for_skills(
	dir: string,
	source: string,
): DiscoveredSkill[] {
	if (!existsSync(dir)) return [];

	const results: DiscoveredSkill[] = [];

	// Direct SKILL.md in this dir
	const direct = join(dir, 'SKILL.md');
	if (existsSync(direct)) {
		const parsed = parse_skill_md(direct);
		if (parsed) {
			results.push({
				...parsed,
				skillPath: direct,
				baseDir: dir,
				source,
			});
		}
		return results; // SKILL.md at root means this IS the skill, don't recurse
	}

	// Glob for skills in subdirs
	try {
		const matches = globSync('*/SKILL.md', { cwd: dir });
		for (const match of matches) {
			const full_path = resolve(dir, match);
			const parsed = parse_skill_md(full_path);
			if (parsed) {
				results.push({
					...parsed,
					skillPath: full_path,
					baseDir: dirname(full_path),
					source,
				});
			}
		}
	} catch {
		// skip inaccessible dirs
	}

	return results;
}

export function scan_all_skills(): DiscoveredSkill[] {
	const all: DiscoveredSkill[] = [];
	const seen = new Set<string>();

	const add = (skill: DiscoveredSkill) => {
		if (seen.has(skill.skillPath)) return;
		seen.add(skill.skillPath);
		all.push(skill);
	};

	// 1. Installed Claude Code plugin skills
	const plugins = read_installed_plugins();
	if (plugins?.plugins) {
		for (const [key, entries] of Object.entries(plugins.plugins)) {
			const entry = entries[0]; // first scope entry
			if (!entry?.installPath || !existsSync(entry.installPath))
				continue;

			const source = `plugin:${key}`;

			// Standard: {installPath}/skills/*/SKILL.md
			for (const s of scan_dir_for_skills(
				join(entry.installPath, 'skills'),
				source,
			)) {
				add(s);
			}

			// Single-skill plugin: {installPath}/SKILL.md
			// Use the file path directly — baseDir would be the versioned cache dir
			// which causes pi's "name doesn't match parent" warning
			const direct = join(entry.installPath, 'SKILL.md');
			if (existsSync(direct)) {
				const parsed = parse_skill_md(direct);
				if (parsed) {
					add({
						...parsed,
						skillPath: direct,
						baseDir: direct,
						source,
					});
				}
			}

			// Pi-specific: {installPath}/.pi/skills/*/SKILL.md
			for (const s of scan_dir_for_skills(
				join(entry.installPath, '.pi', 'skills'),
				source,
			)) {
				add(s);
			}
		}
	}

	// 2. User-local Claude skills
	const claude_skills = join(homedir(), '.claude', 'skills');
	for (const s of scan_dir_for_skills(claude_skills, 'user-local')) {
		add(s);
	}

	// 3. Pi native skills
	const pi_skills = join(homedir(), '.pi', 'agent', 'skills');
	for (const s of scan_dir_for_skills(pi_skills, 'pi-native')) {
		add(s);
	}

	return all;
}
