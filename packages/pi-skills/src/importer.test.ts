import { randomBytes } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';

function tmp_test_dir(): string {
	const dir = join(
		tmpdir(),
		`my-pi-skills-test-${randomBytes(4).toString('hex')}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

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

function write_plugin_registry(
	home_dir: string,
	plugins: Record<
		string,
		{
			installPath: string;
			version: string;
			gitCommitSha?: string;
		}
	>,
): void {
	const plugins_dir = join(home_dir, '.claude', 'plugins');
	mkdirSync(plugins_dir, { recursive: true });
	writeFileSync(
		join(plugins_dir, 'installed_plugins.json'),
		JSON.stringify(
			{
				version: 2,
				plugins: Object.fromEntries(
					Object.entries(plugins).map(([key, value]) => [
						key,
						[
							{
								scope: 'user',
								installPath: value.installPath,
								version: value.version,
								...(value.gitCommitSha
									? { gitCommitSha: value.gitCommitSha }
									: {}),
							},
						],
					]),
				),
			},
			null,
			2,
		),
	);
}

describe('skills importing and syncing', () => {
	let home_dir: string;
	let original_home: string | undefined;
	let original_xdg: string | undefined;

	beforeEach(() => {
		home_dir = tmp_test_dir();
		original_home = process.env.HOME;
		original_xdg = process.env.XDG_CONFIG_HOME;
		process.env.HOME = home_dir;
		process.env.XDG_CONFIG_HOME = join(home_dir, '.config');
		vi.resetModules();
	});

	afterEach(() => {
		if (original_home === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = original_home;
		}
		if (original_xdg === undefined) {
			delete process.env.XDG_CONFIG_HOME;
		} else {
			process.env.XDG_CONFIG_HOME = original_xdg;
		}
		rmSync(home_dir, { recursive: true, force: true });
	});

	it('imports an external plugin skill into pi-native storage with tracking metadata', async () => {
		const install_path = join(
			home_dir,
			'plugin-cache',
			'frontend-design',
			'1.0.0',
		);
		write_skill(
			join(install_path, 'skills', 'frontend-design'),
			'frontend-design',
			'Build beautiful interfaces',
		);
		write_plugin_registry(home_dir, {
			'frontend-design@claude-plugins-official': {
				installPath: install_path,
				version: '1.0.0',
				gitCommitSha: 'abc123def456',
			},
		});

		const { scan_importable_skills, IMPORT_METADATA_FILE } =
			await import('./scanner.js');
		const { import_external_skill } = await import('./importer.js');

		const skill = scan_importable_skills().find(
			(skill) => skill.name === 'frontend-design',
		);
		expect(skill).toBeDefined();
		expect(skill?.kind).toBe('external');

		const result = import_external_skill(skill!);
		expect(result.skillDir).toBe(
			join(home_dir, '.pi', 'agent', 'skills', 'frontend-design'),
		);
		expect(existsSync(join(result.skillDir, 'SKILL.md'))).toBe(true);

		const metadata = JSON.parse(
			readFileSync(
				join(result.skillDir, IMPORT_METADATA_FILE),
				'utf-8',
			),
		) as Record<string, string>;
		expect(metadata.source).toBe(
			'plugin:frontend-design@claude-plugins-official',
		);
		expect(metadata.upstream_skill_path).toContain(
			'skills/frontend-design/SKILL.md',
		);
		expect(metadata.upstream_version).toBe('1.0.0');
		expect(metadata.upstream_git_commit_sha).toBe('abc123def456');
		expect(metadata.imported_hash).toBeTruthy();
		expect(metadata.upstream_hash).toBeTruthy();
	});

	it('syncs an imported skill when the upstream source changes', async () => {
		const install_path = join(
			home_dir,
			'plugin-cache',
			'toolkit-skills',
			'0.0.1',
		);
		const upstream_dir = join(install_path, 'skills', 'github-prs');
		write_skill(
			upstream_dir,
			'github-prs',
			'Find and manage pull requests',
		);
		write_plugin_registry(home_dir, {
			'toolkit-skills@claude-code-toolkit': {
				installPath: install_path,
				version: '0.0.1',
			},
		});

		const scanner = await import('./scanner.js');
		const importer = await import('./importer.js');

		const external = scanner
			.scan_importable_skills()
			.find((skill) => skill.name === 'github-prs');
		importer.import_external_skill(external!);

		writeFileSync(
			join(upstream_dir, 'helper.txt'),
			'new upstream helper content',
		);

		const managed = scanner
			.scan_managed_skills()
			.find((skill) => skill.name === 'github-prs');
		const result = importer.sync_imported_skill(managed!);

		expect(result.changed).toBe(true);
		expect(
			readFileSync(join(result.skillDir, 'helper.txt'), 'utf-8'),
		).toBe('new upstream helper content');
	});

	it('refuses to sync when the managed copy has local changes', async () => {
		const install_path = join(
			home_dir,
			'plugin-cache',
			'linear',
			'2.0.0',
		);
		const upstream_dir = join(install_path, 'skills', 'linear');
		write_skill(upstream_dir, 'linear', 'Work with Linear issues');
		write_plugin_registry(home_dir, {
			'linear@vendor': {
				installPath: install_path,
				version: '2.0.0',
			},
		});

		const scanner = await import('./scanner.js');
		const importer = await import('./importer.js');

		const external = scanner
			.scan_importable_skills()
			.find((skill) => skill.name === 'linear');
		const imported = importer.import_external_skill(external!);

		writeFileSync(
			join(imported.skillDir, 'notes.md'),
			'local customization that should block sync',
		);
		writeFileSync(
			join(upstream_dir, 'notes.md'),
			'upstream changed too',
		);

		const managed = scanner
			.scan_managed_skills()
			.find((skill) => skill.name === 'linear');
		expect(() => importer.sync_imported_skill(managed!)).toThrow(
			/local changes detected/i,
		);
	});

	it('refuses to import plugin skills whose names escape managed storage', async () => {
		const install_path = join(
			home_dir,
			'plugin-cache',
			'malicious-skills',
			'1.0.0',
		);
		write_skill(
			join(install_path, 'skills', 'escape'),
			'../../target',
			'Malicious traversal skill',
		);
		write_plugin_registry(home_dir, {
			'malicious-skills@vendor': {
				installPath: install_path,
				version: '1.0.0',
			},
		});

		const scanner = await import('./scanner.js');
		const importer = await import('./importer.js');

		const external = scanner
			.scan_importable_skills()
			.find((skill) => skill.name === '../../target');
		expect(external).toBeDefined();
		expect(() => importer.import_external_skill(external!)).toThrow(
			/single safe path segment/i,
		);
		expect(existsSync(join(home_dir, '.pi', 'target'))).toBe(false);
	});

	it('refuses absolute imported skill names', async () => {
		const { validate_imported_skill_name } =
			await import('./importer.js');

		expect(() =>
			validate_imported_skill_name('/tmp/not-a-skill'),
		).toThrow(/single safe path segment/i);
	});

	it('manager separates managed and importable skills and enables imported skills', async () => {
		write_skill(
			join(home_dir, '.claude', 'skills', 'github-prs'),
			'github-prs',
			'Local managed GitHub PR skill',
		);

		const install_path = join(
			home_dir,
			'plugin-cache',
			'frontend-design',
			'3.0.0',
		);
		write_skill(
			join(install_path, 'skills', 'frontend-design'),
			'frontend-design',
			'Plugin frontend design skill',
		);
		write_plugin_registry(home_dir, {
			'frontend-design@claude-plugins-official': {
				installPath: install_path,
				version: '3.0.0',
			},
		});

		const { create_skills_manager } = await import('./manager.js');
		const mgr = create_skills_manager();

		expect(mgr.discover().map((skill) => skill.name)).toEqual([
			'github-prs',
		]);
		expect(
			mgr.discover_importable().map((skill) => skill.name),
		).toEqual(['frontend-design']);

		const imported = mgr.import_skill('frontend-design');
		expect(imported.key).toBe('frontend-design@pi-native');

		const managed_names = mgr
			.discover()
			.map((skill) => skill.name)
			.sort();
		expect(managed_names).toEqual(['frontend-design', 'github-prs']);
		expect(mgr.get_enabled_skill_paths()).toContain(
			imported.skillDir,
		);
		expect(
			mgr.is_enabled_by_skill(
				'frontend-design',
				join(imported.skillDir, 'SKILL.md'),
			),
		).toBe(true);
	});
});
