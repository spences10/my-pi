import type { DatabaseSync } from 'node:sqlite';
import * as v from 'valibot';
import { json_record_schema, type JsonRecord } from '../json.js';

const user_version_row_schema = v.object({
	user_version: v.number(),
});

export function now(): string {
	return new Date().toISOString();
}

export function json<T>(value: T): string {
	return JSON.stringify(value ?? null);
}

export function parse_json<T>(
	value: string | null,
	schema: v.GenericSchema<unknown, T>,
	fallback: T,
): T {
	if (!value) return fallback;

	try {
		const parsed = v.safeParse(schema, JSON.parse(value));

		return parsed.success ? parsed.output : fallback;
	} catch {
		return fallback;
	}
}

export function parse_json_record(value: string | null): JsonRecord {
	if (!value) return {};

	try {
		const parsed = v.safeParse(json_record_schema, JSON.parse(value));

		return parsed.success ? parsed.output : {};
	} catch {
		return {};
	}
}

export function optional<T>(value: T | null): T | undefined {
	return value === null ? undefined : value;
}

export function bool(value: number | null | undefined): boolean {
	return value === 1;
}

export function get_user_version(db: DatabaseSync): number {
	return v.parse(
		user_version_row_schema,
		db.prepare('PRAGMA user_version').get(),
	).user_version;
}
