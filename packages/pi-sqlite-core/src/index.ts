import * as v from 'valibot';

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
) {
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

const sqlite_busy_schema = v.looseObject({
	code: v.literal('ERR_SQLITE_ERROR'),
	errcode: v.optional(v.unknown()),
	errstr: v.optional(v.unknown()),
	message: v.fallback(v.optional(v.string()), undefined),
});

export function is_sqlite_busy(cause: unknown): boolean {
	const parsed = v.safeParse(sqlite_busy_schema, cause);

	if (!parsed.success) return false;

	const { errcode, errstr, message } = parsed.output;

	return (
		errcode === 5 ||
		errstr === 'database is locked' ||
		(message?.includes('database is locked') ?? false)
	);
}

export function format_sqlite_busy_message(
	operation = 'SQLite operation',
): string {
	return `${operation} could not acquire the database lock. Please retry shortly.`;
}

export class SqliteBusyError extends Error {
	readonly cause: unknown;

	constructor(operation: string, cause: unknown) {
		super(format_sqlite_busy_message(operation));
		this.name = 'SqliteBusyError';
		this.cause = cause;
	}
}

export function safe_sqlite_tick<T>(fn: () => T): T | undefined {
	try {
		return fn();
	} catch (error) {
		if (is_sqlite_busy(error)) return undefined;
		throw error;
	}
}

function sleep_sync(ms: number): void {
	if (ms <= 0) return;
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function with_sqlite_busy_retry<T>(
	fn: () => T,
	options: {
		attempts?: number;
		delay_ms?: number;
		operation?: string;
		on_busy?: (attempt: number, cause: unknown) => void;
	} = {},
): T {
	const attempts = Math.max(1, options.attempts ?? 3);
	const delay_ms = Math.max(0, options.delay_ms ?? 25);
	let last_error: unknown;

	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			return fn();
		} catch (cause) {
			if (!is_sqlite_busy(cause)) throw cause;
			last_error = cause;
			options.on_busy?.(attempt, cause);

			if (attempt < attempts) sleep_sync(delay_ms * attempt);
		}
	}

	throw new SqliteBusyError(
		options.operation ?? 'SQLite operation',
		last_error,
	);
}

export function with_sqlite_transaction<T>(
	db: { exec(sql: string): void },
	fn: () => T,
	options: {
		immediate?: boolean;
		operation?: string;
		retry?: boolean;
	} = {},
): T {
	const run = (): T => {
		db.exec(options.immediate ? 'BEGIN IMMEDIATE' : 'BEGIN');

		try {
			const result = fn();
			db.exec('COMMIT');

			return result;
		} catch (error) {
			try {
				db.exec('ROLLBACK');
			} catch (rollback_error) {
				if (!is_sqlite_busy(rollback_error)) throw rollback_error;
			}

			throw error;
		}
	};

	return options.retry === false
		? run()
		: with_sqlite_busy_retry(run, { operation: options.operation });
}
