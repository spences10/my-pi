import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ContextStore } from '../store.js';
import type {
	ContextStoreOptions,
	StoreContextInput,
	StoredContextOutput,
} from '../types.js';

let global_options: ContextStoreOptions = {};
let global_enabled = false;
let global_store: ContextStore | null = null;

export function default_context_db_path(): string {
	if (process.env.MY_PI_CONTEXT_DB)
		return process.env.MY_PI_CONTEXT_DB;

	const agent_dir =
		process.env.PI_CODING_AGENT_DIR ??
		join(
			process.env.HOME ?? process.env.USERPROFILE ?? homedir(),
			'.pi',
			'agent',
		);

	return join(agent_dir, 'context.db');
}

export function set_context_sidecar_enabled(
	enabled: boolean,
	options: ContextStoreOptions = {},
): void {
	global_enabled = enabled;

	if (!enabled) {
		global_options = {};
		global_store = null;

		return;
	}

	global_options = { ...global_options, ...options };
}

export function is_context_sidecar_enabled(): boolean {
	return global_enabled;
}

export function get_context_store(
	StoreCtor: typeof ContextStore,
	options: ContextStoreOptions = {},
): ContextStore {
	const merged = { ...global_options, ...options };
	const db_path = merged.db_path ?? default_context_db_path();

	if (!global_store || global_store.db_path !== db_path) {
		global_store = new StoreCtor({ ...merged, db_path });
	} else {
		global_store.configure(merged);
	}

	return global_store;
}

export function maybe_store_context_output(
	StoreCtor: typeof ContextStore,
	input: StoreContextInput,
	options: ContextStoreOptions = {},
): StoredContextOutput | null {
	if (!global_enabled) return null;

	return get_context_store(StoreCtor, options).store(input);
}
