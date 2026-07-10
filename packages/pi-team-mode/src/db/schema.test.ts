import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
	LATEST_TEAM_SCHEMA_VERSION,
	load_migrations,
	MIGRATIONS,
} from './schema.js';

const dirs: string[] = [];

function migration_dir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'pi-team-migrations-'));
	dirs.push(dir);
	return dir;
}

function directory_url(dir: string): URL {
	return pathToFileURL(`${dir}/`);
}

afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

describe('Team Mode migration discovery', () => {
	it('discovers the immutable contiguous migration sequence', () => {
		expect(
			MIGRATIONS.map((migration) => migration.file_name),
		).toEqual([
			'001_initial.sql',
			'002_session_thinking_level.sql',
			'003_session_availability_artifacts.sql',
			'004_persistent_runtimes.sql',
		]);
		expect(LATEST_TEAM_SCHEMA_VERSION).toBe(4);
		expect(MIGRATIONS[0]?.sql).not.toContain('thinking_level');
		expect(MIGRATIONS[1]?.sql).toContain('thinking_level');
	});

	it('rejects gaps instead of silently skipping a version', () => {
		const dir = migration_dir();
		writeFileSync(join(dir, '001_initial.sql'), 'SELECT 1;');
		writeFileSync(join(dir, '003_gap.sql'), 'SELECT 3;');

		expect(() => load_migrations(directory_url(dir))).toThrow(
			'expected 002, found 003_gap.sql',
		);
	});

	it('rejects SQL files that do not follow the numbered convention', () => {
		const dir = migration_dir();
		writeFileSync(join(dir, '001_initial.sql'), 'SELECT 1;');
		writeFileSync(join(dir, 'notes.sql'), 'SELECT 2;');

		expect(() => load_migrations(directory_url(dir))).toThrow(
			'Invalid Team Mode migration filename: notes.sql',
		);
	});
});
