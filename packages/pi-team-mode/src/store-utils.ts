import { redact_text } from '@spences10/pi-redact';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const MAX_EVENT_STRING_LENGTH = 8000;

export function now(): string {
	return new Date().toISOString();
}

export function sanitize_event_data(value: unknown): unknown {
	if (typeof value === 'string') {
		const redacted = redact_text(value).redacted;
		if (redacted.length <= MAX_EVENT_STRING_LENGTH) return redacted;
		return `${redacted.slice(0, MAX_EVENT_STRING_LENGTH)}… [truncated ${redacted.length - MAX_EVENT_STRING_LENGTH} chars]`;
	}
	if (Array.isArray(value)) return value.map(sanitize_event_data);
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, entry]) => [
			key,
			sanitize_event_data(entry),
		]),
	);
}

export function random_suffix(): string {
	return Math.random().toString(36).slice(2, 8);
}

export function safe_segment(value: string): string {
	const sanitized = value
		.trim()
		.replace(/[^a-zA-Z0-9_.-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
	if (!sanitized || sanitized === '.' || sanitized === '..') {
		throw new Error('Expected a file-safe non-empty id');
	}
	return sanitized;
}

export function normalize_member_name(
	value: string | undefined,
	field = 'member',
): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;
	if (safe_segment(trimmed) !== trimmed) {
		throw new Error(
			`${field} must contain only letters, numbers, dots, underscores, and hyphens`,
		);
	}
	return trimmed;
}

export function require_member_name(
	value: string,
	field = 'member',
): string {
	const normalized = normalize_member_name(value, field);
	if (!normalized) throw new Error(`${field} is required`);
	return normalized;
}

export function read_json<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function quarantine_invalid_json(path: string): void {
	const target = `${path}.invalid-${Date.now()}-${random_suffix()}`;
	try {
		renameSync(path, target);
	} catch {
		rmSync(path, { force: true });
	}
}

export function read_listed_json<T>(
	path: string,
	validate?: (value: T) => void,
): T | undefined {
	try {
		const value = read_json<T>(path);
		validate?.(value);
		return value;
	} catch {
		quarantine_invalid_json(path);
		return undefined;
	}
}

export function write_json(path: string, value: unknown): void {
	mkdirSync(resolve(path, '..'), { recursive: true, mode: 0o700 });
	const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${random_suffix()}`;
	writeFileSync(tmp, JSON.stringify(value, null, '\t') + '\n', {
		mode: 0o600,
	});
	renameSync(tmp, path);
}

export function list_json_files<T>(
	dir: string,
	validate?: (value: T) => void,
): T[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
		.sort((a, b) => a.name.localeCompare(b.name))
		.flatMap((entry) => {
			const value = read_listed_json<T>(
				join(dir, entry.name),
				validate,
			);
			return value ? [value] : [];
		});
}

export function normalize_unique_ids(
	values: string[] | undefined,
): string[] {
	return [
		...new Set(
			(values ?? []).map((value) => value.trim()).filter(Boolean),
		),
	].sort();
}

export function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function is_pid_alive(pid: number | undefined): boolean {
	if (!pid || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
