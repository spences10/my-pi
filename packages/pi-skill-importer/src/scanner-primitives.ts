import {
	parseFrontmatter,
	type SkillFrontmatter,
} from '@earendil-works/pi-coding-agent';
import {
	existsSync,
	globSync,
	readFileSync,
	statSync,
} from 'node:fs';
import { basename, dirname, join, parse, resolve } from 'node:path';

export interface ScannedSkill {
	name: string;
	description: string;
	skillPath: string;
	baseDir: string;
}

export interface ScanSkillDirectoryOptions {
	include_direct_root_skill?: boolean;
	include_root_markdown_skills?: boolean;
	exclude_matches?: (match: string) => boolean;
}

function parse_skill_markdown(
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

export function scan_skill_directory(
	dir: string,
	options: ScanSkillDirectoryOptions = {},
): ScannedSkill[] {
	if (!existsSync(dir)) return [];

	const results: ScannedSkill[] = [];
	const direct = join(dir, 'SKILL.md');
	const include_direct_root_skill =
		options.include_direct_root_skill ?? true;

	if (include_direct_root_skill && existsSync(direct)) {
		const parsed = parse_skill_markdown(direct);
		if (parsed) {
			results.push({
				...parsed,
				skillPath: direct,
				baseDir: dir,
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
			const parsed = parse_skill_markdown(full_path);
			if (parsed) {
				results.push({
					...parsed,
					skillPath: full_path,
					baseDir: dirname(full_path),
				});
			}
		}
	} catch {
		// Skip inaccessible directories.
	}

	return results;
}

export function dedupe_skills_by_path<
	Skill extends { skillPath: string },
>(skills: readonly Skill[]): Skill[] {
	const seen = new Set<string>();
	const deduped: Skill[] = [];

	for (const skill of skills) {
		if (seen.has(skill.skillPath)) continue;
		seen.add(skill.skillPath);
		deduped.push(skill);
	}

	return deduped;
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

export function find_project_roots(cwd: string): string[] {
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
