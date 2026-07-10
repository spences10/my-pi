import { with_sqlite_transaction } from '@spences10/pi-sqlite-core';
import type { DatabaseSync } from 'node:sqlite';
import { LATEST_TEAM_SCHEMA_VERSION, MIGRATIONS } from './schema.js';
import { get_user_version } from './util.js';

export function apply_migrations(db: DatabaseSync): void {
	const current_version = get_user_version(db);
	if (current_version > LATEST_TEAM_SCHEMA_VERSION) {
		db.close();
		throw new Error(
			`Team coordination database schema version ${current_version} is newer than supported version ${LATEST_TEAM_SCHEMA_VERSION}`,
		);
	}
	for (const migration of MIGRATIONS) {
		if (migration.version <= current_version) continue;
		with_sqlite_transaction(
			db,
			() => {
				db.exec(migration.sql);
				db.exec(`PRAGMA user_version = ${migration.version}`);
			},
			{
				operation: `Apply team schema migration ${migration.file_name}`,
				retry: false,
			},
		);
	}
}
