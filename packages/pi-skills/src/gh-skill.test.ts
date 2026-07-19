import { describe, expect, it } from 'vitest';
import {
	command_output,
	derive_known_github_repositories,
	github_repository_from_source_url,
	has_gh_skill,
	list_github_repository_skills,
	normalize_github_repo_spec,
	parse_gh_skill_install_args,
	parse_gh_skill_list_output,
	reconcile_github_repository_skills,
	run_gh_skill_install,
	run_gh_skill_install_async,
	run_gh_skill_list,
	run_gh_skill_list_async,
	run_gh_skill_preview,
	run_gh_skill_search,
	run_gh_skill_search_async,
	run_gh_skill_update,
	run_gh_skill_update_async,
	type AsyncCommandRunner,
	type CommandRunner,
	type GhInstalledSkill,
} from './gh-skill.js';

function installed_skill(
	overrides: Partial<GhInstalledSkill> = {},
): GhInstalledSkill {
	return {
		skillName: 'seed',
		sourceURL: 'https://github.com/owner/repo',
		scope: 'user',
		version: 'main',
		pinned: false,
		path: '/skills/seed',
		...overrides,
	};
}

describe('gh skill helpers', () => {
	it('detects GitHub repo install args', () => {
		expect(
			parse_gh_skill_install_args([
				'https://github.com/spences10/skills.git',
				'svelte-runes@v1',
				'--pin',
				'v1',
			]),
		).toEqual({
			repository: 'spences10/skills',
			skill: 'svelte-runes@v1',
			flags: ['--pin', 'v1'],
		});
	});

	it('ignores legacy importer args', () => {
		expect(parse_gh_skill_install_args(['svelte-runes'])).toBeNull();
		expect(
			parse_gh_skill_install_args(['plugin:foo', 'svelte-runes']),
		).toBeNull();
	});

	it('normalizes GitHub repo specs', () => {
		expect(
			normalize_github_repo_spec(
				'https://github.com/spences10/skills.git',
			),
		).toBe('spences10/skills');
	});

	it('checks gh skill availability', () => {
		const runner: CommandRunner = (command, args) => ({
			status:
				command === 'gh' && args.join(' ') === 'skill --help' ? 0 : 1,
			stdout: '',
			stderr: '',
		});
		expect(has_gh_skill(runner)).toBe(true);
	});

	it('lists and normalizes installed Pi skills as typed JSON', () => {
		const calls: Array<[string, string[]]> = [];
		const runner: CommandRunner = (command, args) => {
			calls.push([command, args]);
			return {
				status: 0,
				stdout: JSON.stringify([
					{
						skillName: ' local-skill ',
						sourceURL: ' ',
						scope: 'user',
						version: ' ',
						pinned: false,
						path: ' /skills/local-skill ',
					},
					{ skillName: 'incomplete' },
				]),
				stderr: 'non-JSON warning',
			};
		};

		expect(run_gh_skill_list(runner)).toEqual([
			{
				skillName: 'local-skill',
				sourceURL: '',
				scope: 'user',
				version: '',
				pinned: false,
				path: '/skills/local-skill',
			},
		]);
		expect(calls).toEqual([
			[
				'gh',
				[
					'skill',
					'list',
					'--agent',
					'pi',
					'--json',
					'skillName,sourceURL,scope,version,pinned,path',
				],
			],
		]);
	});

	it('rejects malformed gh skill list JSON', () => {
		expect(() => parse_gh_skill_list_output('{')).toThrow(
			'Invalid gh skill list JSON',
		);
		expect(() => parse_gh_skill_list_output('{}')).toThrow(
			'expected an array',
		);
	});

	it('runs async installed-skill listing with an abort signal', async () => {
		const controller = new AbortController();
		const calls: Array<
			[string, string[], { signal?: AbortSignal } | undefined]
		> = [];
		const runner: AsyncCommandRunner = async (
			command,
			args,
			options,
		) => {
			calls.push([command, args, options]);
			return {
				status: 0,
				stdout: JSON.stringify([installed_skill()]),
				stderr: '',
			};
		};

		await expect(
			run_gh_skill_list_async(runner, {
				signal: controller.signal,
			}),
		).resolves.toEqual([installed_skill()]);
		expect(calls[0]).toEqual([
			'gh',
			[
				'skill',
				'list',
				'--agent',
				'pi',
				'--json',
				'skillName,sourceURL,scope,version,pinned,path',
			],
			{ signal: controller.signal },
		]);
	});

	it('derives unique repositories and ignores empty or malformed sources', () => {
		const known = derive_known_github_repositories([
			installed_skill({ skillName: 'one' }),
			installed_skill({
				skillName: 'two',
				sourceURL: 'https://github.com/owner/repo.git',
				scope: 'project',
				path: '/project/two',
			}),
			installed_skill({ sourceURL: '' }),
			installed_skill({ sourceURL: 'not a URL' }),
			installed_skill({
				sourceURL: 'https://gitlab.com/owner/repo',
			}),
			installed_skill({
				sourceURL: 'https://github.com/owner/repo/tree/main',
			}),
		]);

		expect(known).toHaveLength(1);
		expect(known[0]).toMatchObject({
			repository: 'owner/repo',
			source_url: 'https://github.com/owner/repo',
			source_urls: [
				'https://github.com/owner/repo',
				'https://github.com/owner/repo.git',
			],
			scopes: ['user', 'project'],
		});
		expect(
			known[0]?.installed_skills.map((skill) => skill.path),
		).toEqual(['/skills/seed', '/project/two']);
		expect(
			github_repository_from_source_url('https://github.com/x'),
		).toBeNull();
	});

	it('reconciles duplicate names within their repository and scope provenance', () => {
		const installed = [
			installed_skill({
				skillName: 'shared',
				sourceURL: 'https://github.com/owner/one',
				path: '/user/shared',
			}),
			installed_skill({
				skillName: 'shared',
				sourceURL: 'https://github.com/owner/one',
				scope: 'project',
				path: '/project/shared',
			}),
			installed_skill({
				skillName: 'seed',
				sourceURL: 'https://github.com/owner/two',
				path: '/user/seed',
			}),
		];
		const result = reconcile_github_repository_skills(installed, [
			{
				repository: 'owner/one',
				skills: [
					{ name: 'shared', path: 'shared/SKILL.md' },
					{ name: 'new-one', path: 'new-one/SKILL.md' },
				],
			},
			{
				repository: 'https://github.com/owner/two',
				skills: [
					{ name: 'seed', path: 'seed/SKILL.md' },
					{ name: 'shared', path: 'shared/SKILL.md' },
				],
			},
			{
				repository: 'owner/two',
				skills: [{ name: 'shared', path: 'shared/SKILL.md' }],
			},
		]);

		expect(
			result.available_skills.map(({ repository, name, path }) => ({
				repository,
				name,
				path,
			})),
		).toEqual([
			{
				repository: 'owner/one',
				name: 'new-one',
				path: 'new-one/SKILL.md',
			},
			{
				repository: 'owner/two',
				name: 'shared',
				path: 'shared/SKILL.md',
			},
		]);
		expect(result.available_skills[0]).toMatchObject({
			repository_scopes: ['user', 'project'],
			repository_installations: [
				{ scope: 'user', path: '/user/shared' },
				{ scope: 'project', path: '/project/shared' },
			],
		});
	});

	it('finds operating-tailscale-agent-hosts in a represented repository', () => {
		const result = reconcile_github_repository_skills(
			[
				installed_skill({
					skillName: 'tdd',
					sourceURL: 'https://github.com/spences10/skills',
					path: '/home/test/.pi/agent/skills/tdd',
				}),
			],
			[
				{
					repository: 'spences10/skills',
					skills: [
						{ name: 'tdd', path: 'tdd/SKILL.md' },
						{
							name: 'operating-tailscale-agent-hosts',
							path: 'operating-tailscale-agent-hosts/SKILL.md',
						},
					],
				},
			],
		);

		expect(result.available_skills).toEqual([
			expect.objectContaining({
				repository: 'spences10/skills',
				name: 'operating-tailscale-agent-hosts',
				path: 'operating-tailscale-agent-hosts/SKILL.md',
				repository_scopes: ['user'],
			}),
		]);
	});

	it('runs gh skill install for Pi user scope by default', () => {
		const calls: Array<[string, string[]]> = [];
		const runner: CommandRunner = (command, args) => {
			calls.push([command, args]);
			return { status: 0, stdout: 'installed', stderr: '' };
		};
		expect(
			run_gh_skill_install(
				{
					repository: 'spences10/skills',
					skill: 'svelte-runes',
					flags: ['--pin', 'main'],
				},
				runner,
			),
		).toBe('installed');
		expect(calls).toEqual([
			[
				'gh',
				[
					'skill',
					'install',
					'spences10/skills',
					'svelte-runes',
					'--agent',
					'pi',
					'--scope',
					'user',
					'--pin',
					'main',
				],
			],
		]);
	});

	it('does not duplicate scope defaults when caller overrides placement', () => {
		const calls: Array<[string, string[]]> = [];
		const runner: CommandRunner = (command, args) => {
			calls.push([command, args]);
			return { status: 0, stdout: 'installed', stderr: '' };
		};
		run_gh_skill_install(
			{
				repository: 'spences10/skills',
				skill: 'svelte-runes',
				flags: ['--scope', 'project'],
			},
			runner,
		);
		expect(calls[0]?.[1]).toEqual([
			'skill',
			'install',
			'spences10/skills',
			'svelte-runes',
			'--agent',
			'pi',
			'--scope',
			'project',
		]);
	});

	it('lists skills from a GitHub repository tree', () => {
		const calls: Array<[string, string[]]> = [];
		const runner: CommandRunner = (command, args) => {
			calls.push([command, args]);
			if (args[1] === 'repos/spences10/skills') {
				return {
					status: 0,
					stdout: JSON.stringify({ default_branch: 'main' }),
					stderr: '',
				};
			}
			return {
				status: 0,
				stdout: JSON.stringify({
					tree: [
						{ path: 'svelte-runes/SKILL.md', type: 'blob' },
						{ path: 'svelte-runes/README.md', type: 'blob' },
						{ path: 'nested/tdd/SKILL.md', type: 'blob' },
					],
				}),
				stderr: '',
			};
		};
		expect(
			list_github_repository_skills(
				'spences10/skills',
				undefined,
				runner,
			),
		).toEqual([
			{ name: 'tdd', path: 'nested/tdd/SKILL.md' },
			{ name: 'svelte-runes', path: 'svelte-runes/SKILL.md' },
		]);
		expect(calls).toEqual([
			['gh', ['api', 'repos/spences10/skills']],
			[
				'gh',
				[
					'api',
					'--method',
					'GET',
					'repos/spences10/skills/git/trees/main',
					'-f',
					'recursive=1',
				],
			],
		]);
	});

	it('searches GitHub skills as JSON', () => {
		const calls: Array<[string, string[]]> = [];
		const runner: CommandRunner = (command, args) => {
			calls.push([command, args]);
			return {
				status: 0,
				stdout: JSON.stringify([
					{
						skillName: 'svelte',
						description: 'Svelte skill',
						repo: 'owner/repo',
						path: 'skills/svelte/SKILL.md',
						stars: 42,
						namespace: 'web',
					},
				]),
				stderr: '',
			};
		};
		expect(run_gh_skill_search('svelte', 5, runner)).toEqual([
			{
				skillName: 'svelte',
				description: 'Svelte skill',
				repo: 'owner/repo',
				path: 'skills/svelte/SKILL.md',
				stars: 42,
				namespace: 'web',
			},
		]);
		expect(calls).toEqual([
			[
				'gh',
				[
					'skill',
					'search',
					'svelte',
					'--limit',
					'5',
					'--json',
					'skillName,description,repo,path,stars,namespace',
				],
			],
		]);
	});

	it('previews GitHub skills', () => {
		const calls: Array<[string, string[]]> = [];
		const runner: CommandRunner = (command, args) => {
			calls.push([command, args]);
			return { status: 0, stdout: 'preview', stderr: '' };
		};
		expect(
			run_gh_skill_preview(
				'owner/repo',
				'skills/svelte/SKILL.md',
				runner,
			),
		).toBe('preview');
		expect(calls).toEqual([
			[
				'gh',
				['skill', 'preview', 'owner/repo', 'skills/svelte/SKILL.md'],
			],
		]);
	});

	it('runs gh skill update with passthrough args', () => {
		const calls: Array<[string, string[]]> = [];
		const runner: CommandRunner = (command, args) => {
			calls.push([command, args]);
			return { status: 0, stdout: '', stderr: 'up to date' };
		};
		expect(run_gh_skill_update(['--dry-run'], runner)).toBe(
			'up to date',
		);
		expect(calls).toEqual([['gh', ['skill', 'update', '--dry-run']]]);
	});

	it('runs async gh skill install with defaults and abort signal', async () => {
		const controller = new AbortController();
		const calls: Array<
			[string, string[], { signal?: AbortSignal } | undefined]
		> = [];
		const runner: AsyncCommandRunner = async (
			command,
			args,
			options,
		) => {
			calls.push([command, args, options]);
			return { status: 0, stdout: 'installed', stderr: '' };
		};
		await expect(
			run_gh_skill_install_async(
				{
					repository: 'spences10/skills',
					skill: 'svelte-runes',
					flags: ['--force'],
				},
				runner,
				{ signal: controller.signal },
			),
		).resolves.toBe('installed');
		expect(calls).toEqual([
			[
				'gh',
				[
					'skill',
					'install',
					'spences10/skills',
					'svelte-runes',
					'--agent',
					'pi',
					'--scope',
					'user',
					'--force',
				],
				{ signal: controller.signal },
			],
		]);
	});

	it('runs async gh skill search with abort signal', async () => {
		const controller = new AbortController();
		const calls: Array<
			[string, string[], { signal?: AbortSignal } | undefined]
		> = [];
		const runner: AsyncCommandRunner = async (
			command,
			args,
			options,
		) => {
			calls.push([command, args, options]);
			return {
				status: 0,
				stdout: JSON.stringify([
					{
						skillName: 'react',
						repo: 'owner/repo',
						path: 'react/SKILL.md',
					},
				]),
				stderr: '',
			};
		};
		await expect(
			run_gh_skill_search_async('react', 3, runner, {
				signal: controller.signal,
			}),
		).resolves.toEqual([
			{
				skillName: 'react',
				description: '',
				repo: 'owner/repo',
				path: 'react/SKILL.md',
				stars: 0,
				namespace: '',
			},
		]);
		expect(calls[0]).toEqual([
			'gh',
			[
				'skill',
				'search',
				'react',
				'--limit',
				'3',
				'--json',
				'skillName,description,repo,path,stars,namespace',
			],
			{ signal: controller.signal },
		]);
	});

	it('runs async gh skill update with passthrough args', async () => {
		const calls: Array<[string, string[]]> = [];
		const runner: AsyncCommandRunner = async (command, args) => {
			calls.push([command, args]);
			return { status: 0, stdout: '', stderr: 'updated' };
		};
		await expect(
			run_gh_skill_update_async(['--all'], runner),
		).resolves.toBe('updated');
		expect(calls).toEqual([['gh', ['skill', 'update', '--all']]]);
	});

	it('combines command output', () => {
		expect(
			command_output({ status: 0, stdout: 'out\n', stderr: 'err\n' }),
		).toBe('out\nerr');
	});
});
