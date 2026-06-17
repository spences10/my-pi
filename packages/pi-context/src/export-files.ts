import {
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parse_context_retention_policy } from './policy.js';
import { default_context_db_path } from './store/registry.js';
import type { ContextRetentionPolicy } from './types.js';

const EXPORT_DIR_NAME = 'context-exports';
const DAY_MS = 24 * 60 * 60 * 1000;

export function context_export_dir(): string {
	return join(dirname(default_context_db_path()), EXPORT_DIR_NAME);
}

export function default_context_export_path(
	source_id: string,
	chunk_id?: string,
): string {
	const suffix = chunk_id ? `-${safe_path_segment(chunk_id)}` : '';
	return join(
		context_export_dir(),
		`${safe_path_segment(source_id)}${suffix}.txt`,
	);
}

export function resolve_context_export_path(
	file_path: string | undefined,
	cwd: string,
	source_id: string,
	chunk_id?: string,
): string {
	if (!file_path)
		return default_context_export_path(source_id, chunk_id);
	return isAbsolute(file_path) ? file_path : resolve(cwd, file_path);
}

export function write_context_export_file(
	file_path: string,
	content: string,
): void {
	mkdirSync(dirname(file_path), { recursive: true, mode: 0o700 });
	writeFileSync(file_path, content, {
		encoding: 'utf8',
		mode: 0o600,
	});
}

export function cleanup_context_exports(
	policy: ContextRetentionPolicy = parse_context_retention_policy(),
	now = Date.now(),
): { deleted: number; dir: string } {
	const dir = context_export_dir();
	if (policy.retention_days === null || !existsSync(dir))
		return { deleted: 0, dir };

	const cutoff = now - policy.retention_days * DAY_MS;
	let deleted = 0;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		const stats = statSync(path);
		if (stats.mtimeMs >= cutoff) continue;
		rmSync(path, { recursive: entry.isDirectory(), force: true });
		deleted += 1;
	}
	return { deleted, dir };
}

function safe_path_segment(value: string): string {
	return (
		value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'context'
	);
}
