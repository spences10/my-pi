import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	get_project_profiles_dir,
	get_user_profiles_dir,
	load_teammate_profiles,
	resolve_teammate_profile,
} from './profiles.js';

let root: string;
let cwd: string;
let agent_dir: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'my-pi-team-profiles-'));
	cwd = join(root, 'repo');
	agent_dir = join(root, 'agent');
	mkdirSync(cwd, { recursive: true });
	mkdirSync(agent_dir, { recursive: true });
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function write_json(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(value));
}

describe('teammate profiles', () => {
	it('loads user and project JSON profiles with project overriding user', () => {
		write_json(
			join(get_user_profiles_dir(agent_dir), 'reviewer.json'),
			{
				description: 'User reviewer',
				model: 'anthropic/user-model',
				tools: ['read'],
			},
		);
		write_json(join(get_project_profiles_dir(cwd), 'reviewer.json'), {
			description: 'Project reviewer',
			model: 'anthropic/project-model',
			thinking: 'high',
			system_prompt: 'Review carefully.',
			prompt: 'Start with the assigned task.',
			tools: ['read', 'bash'],
			skills: ['research'],
		});

		const profiles = load_teammate_profiles({ cwd, agent_dir });

		expect(profiles.get('reviewer')).toMatchObject({
			source: 'project',
			description: 'Project reviewer',
			model: 'anthropic/project-model',
			thinking: 'high',
			system_prompt: 'Review carefully.',
			prompt: 'Start with the assigned task.',
			tools: ['read', 'bash'],
			skills: ['research'],
		});
	});

	it('respects project profile trust opt-out', () => {
		write_json(
			join(get_user_profiles_dir(agent_dir), 'reviewer.json'),
			{
				model: 'anthropic/user-model',
			},
		);
		write_json(join(get_project_profiles_dir(cwd), 'reviewer.json'), {
			model: 'anthropic/project-model',
		});

		const profile = resolve_teammate_profile(
			{
				cwd,
				agent_dir,
				env: { MY_PI_TEAM_PROFILES_PROJECT: 'skip' },
			},
			'reviewer',
		);

		expect(profile).toMatchObject({
			source: 'user',
			model: 'anthropic/user-model',
		});
	});
});
