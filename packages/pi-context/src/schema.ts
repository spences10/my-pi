import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

const SCHEMA = readFileSync(
	new URL('./schema.sql', import.meta.url),
	'utf8',
);
const LATEST_CONTEXT_SCHEMA_VERSION = 1;
const PERSISTENT_PRAGMAS = `
PRAGMA journal_mode = WAL;
`;
const CONNECTION_PRAGMAS = `
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
`;
const MIGRATIONS: Record<number, string> = {
	1: SCHEMA,
};

function get_user_version(db: DatabaseSync): number {
	const row = db.prepare('PRAGMA user_version').get() as {
		user_version: number;
	};
	return row.user_version;
}

export function apply_schema(db: DatabaseSync): void {
	db.exec(PERSISTENT_PRAGMAS);
	db.exec(CONNECTION_PRAGMAS);

	const current_version = get_user_version(db);
	if (current_version > LATEST_CONTEXT_SCHEMA_VERSION) {
		db.close();
		throw new Error(
			`Context database schema version ${current_version} is newer than supported version ${LATEST_CONTEXT_SCHEMA_VERSION}`,
		);
	}

	for (
		let next_version = current_version + 1;
		next_version <= LATEST_CONTEXT_SCHEMA_VERSION;
		next_version++
	) {
		const migration = MIGRATIONS[next_version];
		if (!migration) {
			db.close();
			throw new Error(
				`Missing context migration for schema version ${next_version}`,
			);
		}

		db.exec('BEGIN');
		try {
			db.exec(migration);
			db.exec(`PRAGMA user_version = ${next_version}`);
			db.exec('COMMIT');
		} catch (error) {
			db.exec('ROLLBACK');
			db.close();
			throw error;
		}
	}
}
