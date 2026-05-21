import type { BuiltinExtensionKey } from '../extensions/builtin-registry.js';

export interface MyPiSettings {
	version: 1;
	extensions: {
		enabled: Partial<Record<BuiltinExtensionKey, boolean>>;
	};
}

export const DEFAULT_SETTINGS: MyPiSettings = {
	version: 1,
	extensions: {
		enabled: {},
	},
};

export function normalize_settings(value: unknown): MyPiSettings {
	const raw = value as Partial<MyPiSettings> | null | undefined;
	const enabled: MyPiSettings['extensions']['enabled'] = {};
	const raw_enabled = raw?.extensions?.enabled;
	if (raw_enabled && typeof raw_enabled === 'object') {
		for (const [key, state] of Object.entries(raw_enabled)) {
			if (typeof state === 'boolean') {
				enabled[key as BuiltinExtensionKey] = state;
			}
		}
	}

	return {
		version: 1,
		extensions: { enabled },
	};
}
