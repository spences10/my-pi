import { EventEmitter } from 'node:events';
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

	it('does not remove existing warning listeners and installs once', () => {
		const emitter = new EventEmitter() as typeof process;
		const existing = vi.fn();
		emitter.on('warning', existing);

		install_sqlite_warning_filter(emitter);
		install_sqlite_warning_filter(emitter);

		expect(emitter.listenerCount('warning')).toBe(2);
		expect(emitter.listeners('warning')).toContain(existing);
	});
});
