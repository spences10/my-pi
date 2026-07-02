import type { DatabaseSync } from 'node:sqlite';

export function now(): string {
	return new Date().toISOString();
}

export function json<T>(value: T): string {
	return JSON.stringify(value ?? null);
}

export function parse_json<T>(value: string | null, fallback: T): T {
	if (!value) return fallback;
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

export function optional<T>(value: T | null): T | undefined {
	return value === null ? undefined : value;
}

export function bool(value: number | null | undefined): boolean {
	return value === 1;
}

export function get_user_version(db: DatabaseSync): number {
	const row = db.prepare('PRAGMA user_version').get() as {
		user_version: number;
	};
	return row.user_version;
}
