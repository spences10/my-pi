import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

const READ_CHUNK_BYTES = 64 * 1024;
const MAX_CACHE_ENTRIES = 500;

type CacheEntry = {
	dev: number;
	ino: number;
	mtime_ms: number;
	offset: number;
	remainder: Buffer;
	name?: string;
};

const cache = new Map<string, CacheEntry>();

function cache_set(path: string, entry: CacheEntry): void {
	cache.delete(path);
	cache.set(path, entry);
	if (cache.size > MAX_CACHE_ENTRIES)
		cache.delete(cache.keys().next().value!);
}

function session_info_name(line: Buffer): string | undefined {
	if (!line.length) return undefined;
	try {
		const entry = JSON.parse(line.toString('utf8')) as Record<
			string,
			unknown
		>;
		return entry.type === 'session_info' &&
			typeof entry.name === 'string'
			? entry.name || undefined
			: undefined;
	} catch {
		return undefined;
	}
}

function scan_appended(
	fd: number,
	start: number,
	end: number,
	remainder: Buffer,
	initial_name: string | undefined,
): { name?: string; remainder: Buffer } {
	let offset = start;
	let pending = remainder;
	let name = initial_name;
	while (offset < end) {
		const chunk = Buffer.alloc(
			Math.min(READ_CHUNK_BYTES, end - offset),
		);
		const bytes = readSync(fd, chunk, 0, chunk.length, offset);
		if (!bytes) break;
		offset += bytes;
		pending = pending.length
			? Buffer.concat([pending, chunk.subarray(0, bytes)])
			: chunk.subarray(0, bytes);
		let line_start = 0;
		for (let index = 0; index < pending.length; index++) {
			if (pending[index] !== 10) continue;
			const found = session_info_name(
				pending.subarray(line_start, index),
			);
			if (found !== undefined) name = found;
			line_start = index + 1;
		}
		pending = Buffer.from(pending.subarray(line_start));
	}
	return { name, remainder: pending };
}

export function session_name_from_file(
	path: string | undefined,
): string | undefined {
	if (!path) return undefined;
	let fd: number | undefined;
	try {
		fd = openSync(path, 'r');
		const stat = fstatSync(fd);
		const cached = cache.get(path);
		const same_file =
			cached?.dev === stat.dev && cached.ino === stat.ino;
		const unchanged =
			same_file &&
			cached.offset === stat.size &&
			cached.mtime_ms === stat.mtimeMs;
		if (unchanged) {
			cache_set(path, cached);
			return cached.name;
		}
		const can_continue =
			same_file &&
			cached.offset <= stat.size &&
			cached.mtime_ms <= stat.mtimeMs;
		const start = can_continue ? cached.offset : 0;
		const scanned = scan_appended(
			fd,
			start,
			stat.size,
			can_continue ? cached.remainder : Buffer.alloc(0),
			can_continue ? cached.name : undefined,
		);
		const entry: CacheEntry = {
			dev: stat.dev,
			ino: stat.ino,
			mtime_ms: stat.mtimeMs,
			offset: stat.size,
			remainder: scanned.remainder,
			name: scanned.name,
		};
		cache_set(path, entry);
		return entry.name;
	} catch {
		return undefined;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

export function resolve_session_name<
	T extends { session_file?: string; session_name?: string },
>(session: T): T {
	return {
		...session,
		session_name:
			session_name_from_file(session.session_file) ??
			session.session_name,
	};
}
