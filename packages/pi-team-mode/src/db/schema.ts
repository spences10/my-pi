import { readFileSync } from 'node:fs';

export const LATEST_TEAM_SCHEMA_VERSION = 3;

export const SCHEMA = readFileSync(
	new URL('./schema.sql', import.meta.url),
	'utf-8',
);

export const PERSISTENT_PRAGMAS = `
PRAGMA journal_mode = WAL;
`;

export const CONNECTION_PRAGMAS = `
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
`;

export const MIGRATIONS: Record<number, string> = {
	1: SCHEMA,
	2: readFileSync(
		new URL(
			'./migrations/002_session_thinking_level.sql',
			import.meta.url,
		),
		'utf-8',
	),
	3: readFileSync(
		new URL(
			'./migrations/003_session_availability_artifacts.sql',
			import.meta.url,
		),
		'utf-8',
	),
};
