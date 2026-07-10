import {
	SQLITE_CONNECTION_PRAGMAS,
	SQLITE_PERSISTENT_PRAGMAS,
} from '@spences10/pi-sqlite-core';
import { readFileSync, readdirSync } from 'node:fs';

export interface TeamSchemaMigration {
	version: number;
	file_name: string;
	sql: string;
}

const MIGRATION_FILE_PATTERN = /^(\d{3})_[a-z0-9_]+\.sql$/;

export function load_migrations(
	directory: URL = new URL('./migrations/', import.meta.url),
): TeamSchemaMigration[] {
	const sql_files = readdirSync(directory)
		.filter((file_name) => file_name.endsWith('.sql'))
		.sort();
	if (sql_files.length === 0)
		throw new Error('No Team Mode database migrations found');

	const migrations = sql_files.map((file_name) => {
		const match = MIGRATION_FILE_PATTERN.exec(file_name);
		if (!match)
			throw new Error(
				`Invalid Team Mode migration filename: ${file_name}`,
			);
		return {
			version: Number(match[1]),
			file_name,
			sql: readFileSync(new URL(file_name, directory), 'utf8'),
		};
	});
	for (const [index, migration] of migrations.entries()) {
		const expected_version = index + 1;
		if (migration.version !== expected_version) {
			throw new Error(
				`Team Mode migrations must be contiguous: expected ${expected_version.toString().padStart(3, '0')}, found ${migration.file_name}`,
			);
		}
	}
	return migrations;
}

export const MIGRATIONS = load_migrations();
export const LATEST_TEAM_SCHEMA_VERSION = MIGRATIONS.at(-1)!.version;
export const PERSISTENT_PRAGMAS = SQLITE_PERSISTENT_PRAGMAS;
export const CONNECTION_PRAGMAS = SQLITE_CONNECTION_PRAGMAS;
