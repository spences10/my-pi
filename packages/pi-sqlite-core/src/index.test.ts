import { describe, expect, it, vi } from 'vitest';
import {
	is_sqlite_busy,
	safe_sqlite_tick,
	sqlite_pragmas,
	with_sqlite_busy_retry,
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

		expect(with_sqlite_busy_retry(fn)).toBe('ok');
		expect(fn).toHaveBeenCalledTimes(2);
	});
});
