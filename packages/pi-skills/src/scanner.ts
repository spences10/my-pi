import { getAgentDir } from '@earendil-works/pi-coding-agent';
import {
	dedupe_skills_by_path,
	find_project_roots,
	scan_skill_directory,
	type ScanSkillDirectoryOptions,
} from '@spences10/pi-skill-importer';
import { join } from 'node:path';

export type SkillScope = 'global' | 'project';

export interface DiscoveredSkill {
	name: string;
	description: string;
	skillPath: string;
	baseDir: string;
	source: string;
	scope: SkillScope;
	kind: 'managed';
}

interface ManagedSkillScanOptions extends ScanSkillDirectoryOptions {
	source: string;
	scope: SkillScope;
}

function scan_dir_for_skills(
	dir: string,
	options: ManagedSkillScanOptions,
): DiscoveredSkill[] {
	return scan_skill_directory(dir, options).map((skill) => ({
		...skill,
		source: options.source,
		scope: options.scope,
		kind: 'managed',
	}));
}

export function scan_managed_skills(): DiscoveredSkill[] {
	return dedupe_skills_by_path(
		scan_dir_for_skills(join(getAgentDir(), 'skills'), {
			source: 'pi-native',
			scope: 'global',
			include_direct_root_skill: false,
			include_root_markdown_skills: true,
		}),
	);
}

export function scan_project_skills(
	cwd = process.cwd(),
): DiscoveredSkill[] {
	const skills: DiscoveredSkill[] = [];
	for (const root of find_project_roots(cwd)) {
		for (const skill of scan_dir_for_skills(join(root, '.agents'), {
			source: 'project:.agents',
			scope: 'project',
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
				include_direct_root_skill: false,
				include_root_markdown_skills: true,
			},
		)) {
			skills.push(skill);
		}
	}
	return dedupe_skills_by_path(skills);
}
