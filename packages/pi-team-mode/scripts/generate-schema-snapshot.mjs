import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [, , migrations_arg, output_arg] = process.argv;
if (!migrations_arg || !output_arg) {
	throw new Error(
		'Usage: generate-schema-snapshot <migrations-dir> <output-file>',
	);
}

const migrations_dir = resolve(migrations_arg);
const output_file = resolve(output_arg);
const pattern = /^(\d{3})_[a-z0-9_]+\.sql$/;
const files = readdirSync(migrations_dir)
	.filter((file) => file.endsWith('.sql'))
	.sort();
if (files.length === 0) throw new Error('No migration files found');

const db = new DatabaseSync(':memory:');
try {
	for (const [index, file] of files.entries()) {
		const match = pattern.exec(file);
		const expected = index + 1;
		if (!match || Number(match[1]) !== expected) {
			throw new Error(
				`Expected migration ${String(expected).padStart(3, '0')}, found ${file}`,
			);
		}
		db.exec(readFileSync(resolve(migrations_dir, file), 'utf8'));
		db.exec(`PRAGMA user_version = ${expected}`);
	}

	const rows = db
		.prepare(
			`SELECT type, name, sql
			 FROM sqlite_master
			 WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
			 ORDER BY CASE type
				WHEN 'table' THEN 0
				WHEN 'index' THEN 1
				WHEN 'view' THEN 2
				WHEN 'trigger' THEN 3
				ELSE 4
			 END, name`,
		)
		.all();
	const schema = [
		'-- Generated from immutable numbered migrations. Do not edit.',
		`-- Latest migration: ${files.at(-1)}`,
		'',
		...rows.flatMap(({ sql }) => [`${String(sql).trim()};`, '']),
		`PRAGMA user_version = ${files.length};`,
		'',
	].join('\n');
	const verification = new DatabaseSync(':memory:');
	try {
		verification.exec(schema);
		const version = verification.prepare('PRAGMA user_version').get();
		const names = verification
			.prepare(
				"SELECT name FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name",
			)
			.all()
			.map(({ name }) => name);
		const expected_names = rows
			.map(({ name }) => name)
			.sort((a, b) => String(a).localeCompare(String(b)));
		if (
			version.user_version !== files.length ||
			JSON.stringify(names) !== JSON.stringify(expected_names)
		) {
			throw new Error(
				'Generated schema snapshot verification failed',
			);
		}
	} finally {
		verification.close();
	}
	writeFileSync(output_file, schema);
} finally {
	db.close();
}
