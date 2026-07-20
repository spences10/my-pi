import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	dedupe_skills_by_path,
	find_project_roots,
	scan_skill_directory,
} from './scanner-primitives.js';

const temp_dirs: string[] = [];

function make_temp_dir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'pi-skill-scanner-'));
	temp_dirs.push(dir);
	return dir;
}

function write_skill(
	path: string,
	description = 'Scanner fixture',
): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(
		path,
		`---\ndescription: ${description}\n---\n\n# Fixture\n`,
	);
}

afterEach(() => {
	for (const dir of temp_dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe('skill scanner primitives', () => {
	it('preserves direct-root precedence and inferred names', () => {
		const root = make_temp_dir();
		write_skill(join(root, 'SKILL.md'), '  Direct fixture  ');
		write_skill(join(root, 'nested', 'SKILL.md'));

		expect(scan_skill_directory(root)).toEqual([
			{
				name: basename(root),
				description: 'Direct fixture',
				skillPath: join(root, 'SKILL.md'),
				baseDir: root,
			},
		]);
	});

	it('sorts recursive and root Markdown skills while applying exclusions', () => {
		const root = make_temp_dir();
		write_skill(join(root, 'zeta', 'SKILL.md'));
		write_skill(join(root, 'alpha', 'SKILL.md'));
		write_skill(join(root, 'standalone.md'));

		const skills = scan_skill_directory(root, {
			include_direct_root_skill: false,
			include_root_markdown_skills: true,
			exclude_matches: (match) => match.startsWith('zeta/'),
		});

		expect(skills.map((skill) => skill.name)).toEqual([
			'alpha',
			'standalone',
		]);
	});

	it('deduplicates by skill path while retaining the first match', () => {
		const first = { skillPath: '/skills/example', source: 'first' };
		const duplicate = {
			skillPath: '/skills/example',
			source: 'second',
		};

		expect(dedupe_skills_by_path([first, duplicate])).toEqual([
			first,
		]);
	});

	it('walks upward only through the nearest Git project root', () => {
		const root = make_temp_dir();
		const nested = join(root, 'one', 'two');
		mkdirSync(join(root, '.git'));
		mkdirSync(nested, { recursive: true });

		expect(find_project_roots(nested)).toEqual([
			nested,
			join(root, 'one'),
			root,
		]);
	});
});
