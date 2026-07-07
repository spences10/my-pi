export const DEFAULT_SQLITE_BUSY_TIMEOUT_MS = 5000;

export const SQLITE_PERSISTENT_PRAGMAS = `
PRAGMA journal_mode = WAL;
`;

export const SQLITE_CONNECTION_PRAGMAS = `
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = ${DEFAULT_SQLITE_BUSY_TIMEOUT_MS};
`;

export function sqlite_pragmas(
	options: {
		foreign_keys?: boolean;
		busy_timeout_ms?: number;
	} = {},
): { persistent: string; connection: string } {
	const foreign_keys = options.foreign_keys ?? true;
	const busy_timeout_ms =
		options.busy_timeout_ms ?? DEFAULT_SQLITE_BUSY_TIMEOUT_MS;
	return {
		persistent: SQLITE_PERSISTENT_PRAGMAS,
		connection: [
			foreign_keys ? 'PRAGMA foreign_keys = ON;' : undefined,
			`PRAGMA busy_timeout = ${busy_timeout_ms};`,
		]
			.filter(Boolean)
			.join('\n'),
	};
}

export function is_sqlite_busy(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false;
	const candidate = error as {
		code?: unknown;
		errcode?: unknown;
		errstr?: unknown;
		message?: unknown;
	};
	return (
		candidate.code === 'ERR_SQLITE_ERROR' &&
		(candidate.errcode === 5 ||
			candidate.errstr === 'database is locked' ||
			(typeof candidate.message === 'string' &&
				candidate.message.includes('database is locked')))
	);
}

export function safe_sqlite_tick<T>(fn: () => T): T | undefined {
	try {
		return fn();
	} catch (error) {
		if (is_sqlite_busy(error)) return undefined;
		throw error;
	}
}

export function with_sqlite_busy_retry<T>(
	fn: () => T,
	options: {
		attempts?: number;
		on_busy?: (attempt: number, error: unknown) => void;
	} = {},
): T {
	const attempts = Math.max(1, options.attempts ?? 2);
	let last_error: unknown;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			return fn();
		} catch (error) {
			if (!is_sqlite_busy(error)) throw error;
			last_error = error;
			options.on_busy?.(attempt, error);
		}
	}
	throw last_error;
}
