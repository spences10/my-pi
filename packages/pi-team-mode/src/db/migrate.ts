import type { DatabaseSync } from 'node:sqlite';
import {
	LATEST_TEAM_SCHEMA_VERSION,
	MIGRATIONS,
	SCHEMA,
} from './schema.js';
import { get_user_version } from './util.js';

export function apply_migrations(db: DatabaseSync): void {
	const current_version = get_user_version(db);
	if (current_version > LATEST_TEAM_SCHEMA_VERSION) {
		db.close();
		throw new Error(
			`Team coordination database schema version ${current_version} is newer than supported version ${LATEST_TEAM_SCHEMA_VERSION}`,
		);
	}
	if (current_version === 0) {
		db.exec('BEGIN');
		try {
			db.exec(SCHEMA);
			db.exec(`PRAGMA user_version = ${LATEST_TEAM_SCHEMA_VERSION}`);
			db.exec('COMMIT');
		} catch (error) {
			db.exec('ROLLBACK');
			throw error;
		}
		return;
	}
	for (
		let next_version = current_version + 1;
		next_version <= LATEST_TEAM_SCHEMA_VERSION;
		next_version++
	) {
		const migration = MIGRATIONS[next_version];
		if (!migration)
			throw new Error(
				`Missing team coordination migration ${next_version}`,
			);
		db.exec('BEGIN');
		try {
			db.exec(migration);
			db.exec(`PRAGMA user_version = ${next_version}`);
			db.exec('COMMIT');
		} catch (error) {
			db.exec('ROLLBACK');
			throw error;
		}
	}
}
