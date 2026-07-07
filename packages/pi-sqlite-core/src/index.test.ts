import { describe, expect, it, vi } from 'vitest';
import {
	SqliteBusyError,
	is_sqlite_busy,
	safe_sqlite_tick,
	sqlite_pragmas,
	with_sqlite_busy_retry,
	with_sqlite_transaction,
} from './index.js';

const busy_error = Object.assign(new Error('database is locked'), {
	code: 'ERR_SQLITE_ERROR',
	errcode: 5,
	errstr: 'database is locked',
});

describe('sqlite core helpers', () => {
	it('builds shared connection pragmas', () => {
		expect(sqlite_pragmas().persistent).toContain(
			'journal_mode = WAL',
		);
		expect(sqlite_pragmas().connection).toContain(
			'foreign_keys = ON',
		);
		expect(sqlite_pragmas().connection).toContain(
			'busy_timeout = 5000',
		);
		expect(
			sqlite_pragmas({ foreign_keys: false }).connection,
		).not.toContain('foreign_keys');
	});

	it('detects SQLite busy errors', () => {
		expect(is_sqlite_busy(busy_error)).toBe(true);
		expect(
			is_sqlite_busy({ code: 'ERR_SQLITE_ERROR', errcode: 5 }),
		).toBe(true);
		expect(
			is_sqlite_busy({
				code: 'ERR_SQLITE_ERROR',
				message: 'SQLITE_BUSY: database is locked',
			}),
		).toBe(true);
		expect(is_sqlite_busy(new Error('boom'))).toBe(false);
	});

	it('suppresses busy errors for safe background ticks', () => {
		expect(
			safe_sqlite_tick(() => {
				throw busy_error;
			}),
		).toBeUndefined();
		expect(() =>
			safe_sqlite_tick(() => {
				throw new Error('boom');
			}),
		).toThrow('boom');
	});

	it('retries busy sync work', () => {
		const fn = vi
			.fn<() => string>()
			.mockImplementationOnce(() => {
				throw busy_error;
			})
			.mockReturnValueOnce('ok');

		expect(with_sqlite_busy_retry(fn, { delay_ms: 0 })).toBe('ok');
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it('throws a retryable busy error after attempts are exhausted', () => {
		expect(() =>
			with_sqlite_busy_retry(
				() => {
					throw busy_error;
				},
				{ attempts: 1, operation: 'Write context output' },
			),
		).toThrow(SqliteBusyError);
	});

	it('commits and rolls back transactions', () => {
		const db = { exec: vi.fn() };
		expect(
			with_sqlite_transaction(db, () => 'ok', {
				immediate: true,
				retry: false,
			}),
		).toBe('ok');
		expect(db.exec).toHaveBeenNthCalledWith(1, 'BEGIN IMMEDIATE');
		expect(db.exec).toHaveBeenNthCalledWith(2, 'COMMIT');

		db.exec.mockClear();
		expect(() =>
			with_sqlite_transaction(
				db,
				() => {
					throw new Error('boom');
				},
				{ retry: false },
			),
		).toThrow('boom');
		expect(db.exec).toHaveBeenNthCalledWith(1, 'BEGIN');
		expect(db.exec).toHaveBeenNthCalledWith(2, 'ROLLBACK');
	});
});
