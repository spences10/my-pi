import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scan_project_skills } from './scanner.js';

const temp_dirs: string[] = [];

function make_project(): string {
	const root = mkdtempSync(join(tmpdir(), 'pi-skills-project-'));
	temp_dirs.push(root);
	mkdirSync(join(root, '.git'));
	return root;
}

function write_skill(path: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(
		path,
		'---\ndescription: Scanner fixture\n---\n\n# Fixture\n',
	);
}

afterEach(() => {
	for (const dir of temp_dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe('packages/pi-skills/src/scanner.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./scanner.js')).resolves.toBeDefined();
	});

	it('preserves project sources, root Markdown skills, and deduplication', () => {
		const root = make_project();
		write_skill(join(root, '.agents', 'general', 'SKILL.md'));
		write_skill(
			join(root, '.agents', 'skills', 'shared', 'SKILL.md'),
		);
		write_skill(join(root, '.pi', 'skills', 'standalone.md'));

		expect(
			scan_project_skills(root).map(
				({ name, source, scope, skillPath }) => ({
					name,
					source,
					scope,
					skillPath,
				}),
			),
		).toEqual([
			{
				name: 'general',
				source: 'project:.agents',
				scope: 'project',
				skillPath: join(root, '.agents', 'general', 'SKILL.md'),
			},
			{
				name: 'shared',
				source: 'project:.agents/skills',
				scope: 'project',
				skillPath: join(
					root,
					'.agents',
					'skills',
					'shared',
					'SKILL.md',
				),
			},
			{
				name: 'standalone',
				source: 'project:.pi/skills',
				scope: 'project',
				skillPath: join(root, '.pi', 'skills', 'standalone.md'),
			},
		]);
	});
});
