import { write_package_settings } from '@spences10/pi-settings';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vite-plus/test';

function write_skill(
	base_dir: string,
	name: string,
	description: string,
): void {
	mkdirSync(base_dir, { recursive: true });
	writeFileSync(
		join(base_dir, 'SKILL.md'),
		`---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
	);
}

function add_github_remote(project: string, remote: string): void {
	mkdirSync(project, { recursive: true });
	execFileSync('git', ['init'], { cwd: project, stdio: 'ignore' });
	execFileSync('git', ['remote', 'add', 'origin', remote], {
		cwd: project,
		stdio: 'ignore',
	});
}

describe('create_skills_manager', () => {
	let root: string;
	let original_home: string | undefined;
	let original_xdg: string | undefined;
	let original_agent_dir: string | undefined;

	beforeEach(() => {
		root = join(
			tmpdir(),
			`my-pi-skills-manager-${Date.now()}-${Math.random()}`,
		);
		original_home = process.env.HOME;
		original_xdg = process.env.XDG_CONFIG_HOME;
		original_agent_dir = process.env.PI_CODING_AGENT_DIR;
		process.env.HOME = root;
		process.env.XDG_CONFIG_HOME = join(root, '.config');
		process.env.PI_CODING_AGENT_DIR = join(root, 'agent');
		vi.resetModules();
	});

	afterEach(() => {
		if (original_home === undefined) delete process.env.HOME;
		else process.env.HOME = original_home;
		if (original_xdg === undefined)
			delete process.env.XDG_CONFIG_HOME;
		else process.env.XDG_CONFIG_HOME = original_xdg;
		if (original_agent_dir === undefined)
			delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = original_agent_dir;
		rmSync(root, { recursive: true, force: true });
	});

	it('discovers project .agents skills as managed project skills', async () => {
		const project = join(root, 'repo');
		write_skill(
			join(project, '.agents', 'project-navigation'),
			'project-navigation',
			'Navigate this project.',
		);

		const { create_skills_manager } = await import('./manager.js');
		const mgr = create_skills_manager({ cwd: project });
		const skill = mgr
			.discover()
			.find((candidate) => candidate.name === 'project-navigation');

		expect(skill).toMatchObject({
			key: 'project-navigation@project:.agents',
			source: 'project:.agents',
			scope: 'project',
			enabled: true,
		});
		expect(mgr.get_enabled_skill_paths()).toContain(
			join(project, '.agents', 'project-navigation', 'SKILL.md'),
		);
	});

	it('discovers recursive SKILL.md and root .pi skill markdown files', async () => {
		const project = join(root, 'repo');
		write_skill(
			join(project, '.agents', 'skills', 'nested', 'deep'),
			'deep-skill',
			'Use the deep skill.',
		);
		mkdirSync(join(project, '.pi', 'skills'), { recursive: true });
		writeFileSync(
			join(project, '.pi', 'skills', 'root-helper.md'),
			'---\ndescription: Use the root helper.\n---\n\n# Root helper\n',
		);

		const { create_skills_manager } = await import('./manager.js');
		const mgr = create_skills_manager({ cwd: project });
		const skills = mgr.discover();

		expect(
			skills.find((candidate) => candidate.name === 'deep-skill'),
		).toMatchObject({ source: 'project:.agents/skills' });
		expect(
			skills.find((candidate) => candidate.name === 'root-helper'),
		).toMatchObject({ source: 'project:.pi/skills' });
	});

	it('does not return default pi-native skills as explicit skill paths', async () => {
		write_skill(
			join(root, 'agent', 'skills', 'local-tooling'),
			'local-tooling',
			'Use local tooling.',
		);

		const { create_skills_manager } = await import('./manager.js');
		const mgr = create_skills_manager();
		mgr.enable('local-tooling@pi-native');

		expect(
			mgr.discover().find((skill) => skill.name === 'local-tooling')
				?.enabled,
		).toBe(true);
		expect(mgr.get_enabled_skill_paths()).not.toContain(
			join(root, 'agent', 'skills', 'local-tooling', 'SKILL.md'),
		);
	});

	it('uses context profiles to enable global skills without hardcoding project names', async () => {
		const project = join(root, 'repos', 'example-suite', 'app');
		write_skill(
			join(root, 'agent', 'skills', 'suite-table-helper'),
			'suite-table-helper',
			'Use for example suite tables.',
		);
		write_package_settings('skills', {
			version: 3,
			enabled: {},
			defaults: 'all-disabled',
			current_profile: 'default',
			profiles: {
				default: { include: [], exclude: [] },
				suite: { include: ['suite-*'], exclude: [] },
			},
			contexts: [
				{
					name: 'example suite repos',
					profile: 'suite',
					when: { cwd: join(root, 'repos', 'example-suite', '*') },
				},
			],
		});

		const { create_skills_manager } = await import('./manager.js');

		expect(
			create_skills_manager({ cwd: join(root, 'other') })
				.discover()
				.find((skill) => skill.name === 'suite-table-helper')
				?.enabled,
		).toBe(false);
		expect(
			create_skills_manager({ cwd: project })
				.discover()
				.find((skill) => skill.name === 'suite-table-helper')
				?.enabled,
		).toBe(true);
	});

	it('uses github org contexts to enable global skills', async () => {
		const project = join(root, 'repos', 'my-pi');
		add_github_remote(project, 'git@github.com:spences10/my-pi.git');
		write_skill(
			join(root, 'agent', 'skills', 'spences-tooling'),
			'spences-tooling',
			'Use for spences10 repos.',
		);
		write_package_settings('skills', {
			version: 3,
			enabled: {},
			defaults: 'all-disabled',
			current_profile: 'default',
			profiles: {
				default: { include: [], exclude: [] },
				spences: { include: ['spences-*'], exclude: [] },
			},
			contexts: [
				{
					profile: 'spences',
					when: { github_org: 'spences10' },
				},
			],
		});

		const { create_skills_manager } = await import('./manager.js');

		expect(
			create_skills_manager({ cwd: project })
				.discover()
				.find((skill) => skill.name === 'spences-tooling')?.enabled,
		).toBe(true);
		expect(
			create_skills_manager({ cwd: join(root, 'other') })
				.discover()
				.find((skill) => skill.name === 'spences-tooling')?.enabled,
		).toBe(false);
	});

	it('uses github repo contexts to enable global skills', async () => {
		const project = join(root, 'repos', 'my-pi');
		add_github_remote(
			project,
			'https://github.com/spences10/my-pi.git',
		);
		write_skill(
			join(root, 'agent', 'skills', 'repo-tooling'),
			'repo-tooling',
			'Use for a specific repo.',
		);
		write_package_settings('skills', {
			version: 3,
			enabled: {},
			defaults: 'all-disabled',
			current_profile: 'default',
			profiles: {
				default: { include: [], exclude: [] },
				repo: { include: ['repo-*'], exclude: [] },
			},
			contexts: [
				{
					profile: 'repo',
					when: { github_repo: 'spences10/my-pi' },
				},
			],
		});

		const { create_skills_manager } = await import('./manager.js');

		expect(
			create_skills_manager({ cwd: project })
				.discover()
				.find((skill) => skill.name === 'repo-tooling')?.enabled,
		).toBe(true);
		expect(
			create_skills_manager({ cwd: join(root, 'other') })
				.discover()
				.find((skill) => skill.name === 'repo-tooling')?.enabled,
		).toBe(false);
	});

	it('can disable project skill injection for untrusted repos', async () => {
		const project = join(root, 'repo');
		write_skill(
			join(project, '.agents', 'project-navigation'),
			'project-navigation',
			'Navigate this project.',
		);

		const { create_skills_manager } = await import('./manager.js');
		const mgr = create_skills_manager({
			cwd: project,
			project_skills_enabled: false,
		});

		expect(
			mgr
				.discover()
				.find((skill) => skill.name === 'project-navigation')
				?.enabled,
		).toBe(false);
		expect(mgr.get_enabled_skill_paths()).not.toContain(
			join(project, '.agents', 'project-navigation', 'SKILL.md'),
		);
	});
});
