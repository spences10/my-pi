import { describe, expect, it } from 'vitest';
import { create_team_child_env } from './child-env.js';

const source_env = {
	HOME: '/home/pi',
	PATH: '/usr/bin',
	LANG: 'en_US.UTF-8',
	LC_ALL: 'C',
	ANTHROPIC_API_KEY: 'secret-anthropic',
	AWS_SECRET_ACCESS_KEY: 'secret-aws',
	DATABASE_URL: 'postgres://secret',
	MY_PI_CHILD_ENV_ALLOWLIST: 'SHARED_TOKEN',
	MY_PI_TEAM_MODE_ENV_ALLOWLIST: 'ANTHROPIC_API_KEY, TEAM_TOKEN',
	SHARED_TOKEN: 'shared',
	TEAM_TOKEN: 'team',
};

describe('create_team_child_env', () => {
	it('keeps only baseline and explicitly allowlisted values', () => {
		expect(create_team_child_env({ source_env })).toEqual({
			HOME: '/home/pi',
			PATH: '/usr/bin',
			LANG: 'en_US.UTF-8',
			LC_ALL: 'C',
			ANTHROPIC_API_KEY: 'secret-anthropic',
			SHARED_TOKEN: 'shared',
			TEAM_TOKEN: 'team',
		});
	});

	it('does not inherit cloud or database secrets by default', () => {
		const env = create_team_child_env({
			source_env: {
				PATH: '/usr/bin',
				AWS_SECRET_ACCESS_KEY: 'secret-aws',
				DATABASE_URL: 'postgres://secret',
				OPENAI_API_KEY: 'secret-openai',
			},
		});

		expect(env).toEqual({ PATH: '/usr/bin' });
	});

	it('applies explicit child identity values without inheriting the source', () => {
		expect(
			create_team_child_env({
				source_env,
				explicit_env: {
					MY_PI_TEAM_ROLE: 'teammate',
					DATABASE_URL: undefined,
				},
			}),
		).toMatchObject({ MY_PI_TEAM_ROLE: 'teammate' });
	});
});
