import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { ContextStore } from '../src/store.js';

const dirs: string[] = [];
const stores: ContextStore[] = [];

export function temp_path(prefix: string, filename: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return join(dir, filename);
}

export function temp_db(prefix = 'pi-context-'): string {
	return temp_path(prefix, 'context.db');
}

export function temp_config(prefix = 'pi-context-config-'): string {
	return temp_path(prefix, 'context.json');
}

export function create_context_store(
	options: ConstructorParameters<typeof ContextStore>[0] = {},
	prefix = 'pi-context-',
): ContextStore {
	const store = new ContextStore({
		db_path: temp_db(prefix),
		...options,
	});
	stores.push(store);
	return store;
}

export function track_context_store(
	store: ContextStore,
): ContextStore {
	stores.push(store);
	return store;
}

afterEach(() => {
	for (const store of stores.splice(0)) {
		try {
			store.close();
		} catch {
			// already closed
		}
	}
	for (const dir of dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});
