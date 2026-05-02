import { describe, expect, it, vi } from 'vitest';
import {
	install_sqlite_warning_filter,
	should_suppress_warning,
} from './warnings.js';

describe('warning handling', () => {
	it('suppresses only the node:sqlite experimental warning', () => {
		const sqlite = new Error(
			'SQLite is an experimental feature and might change at any time',
		);
		sqlite.name = 'ExperimentalWarning';
		const other = new Error('Other experimental feature');
		other.name = 'ExperimentalWarning';

		expect(should_suppress_warning(sqlite)).toBe(true);
		expect(should_suppress_warning(other)).toBe(false);
	});

	it('filters node:sqlite warnings before delegating to emitWarning', () => {
		const original_emit_warning = vi.fn();
		const process_like = {
			emitWarning: original_emit_warning,
		} as unknown as typeof process;

		install_sqlite_warning_filter(process_like);
		install_sqlite_warning_filter(process_like);

		process_like.emitWarning(
			'SQLite is an experimental feature and might change at any time',
			'ExperimentalWarning',
		);
		process_like.emitWarning('Something else', 'ExperimentalWarning');

		expect(original_emit_warning).toHaveBeenCalledOnce();
		expect(original_emit_warning).toHaveBeenCalledWith(
			'Something else',
			'ExperimentalWarning',
		);
	});
});
