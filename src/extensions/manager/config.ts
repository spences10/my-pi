import {
	BUILTIN_EXTENSIONS,
	type BuiltinExtensionInfo,
	type BuiltinExtensionKey,
} from '../builtin-registry.js';
import {
	get_settings_path,
	load_settings,
	save_settings,
} from '../../settings/index.js';

export { BUILTIN_EXTENSIONS };
export type { BuiltinExtensionInfo, BuiltinExtensionKey };

export interface BuiltinExtensionsConfig {
	version: number;
	enabled: Partial<Record<BuiltinExtensionKey, boolean>>;
}

export interface BuiltinExtensionState extends BuiltinExtensionInfo {
	saved_enabled: boolean;
	effective_enabled: boolean;
	forced_disabled: boolean;
}

export function get_builtin_extensions_config_path(): string {
	return get_settings_path();
}

export function load_builtin_extensions_config(): BuiltinExtensionsConfig {
	const settings = load_settings();
	const enabled: BuiltinExtensionsConfig['enabled'] = {};
	for (const extension of BUILTIN_EXTENSIONS) {
		const value = settings.extensions.enabled[extension.key];
		if (typeof value === 'boolean') enabled[extension.key] = value;
	}
	return { version: 1, enabled };
}

export function save_builtin_extensions_config(
	config: BuiltinExtensionsConfig,
): void {
	const settings = load_settings();
	save_settings({
		...settings,
		extensions: {
			...settings.extensions,
			enabled: config.enabled,
		},
	});
}

export function is_builtin_extension_enabled(
	config: BuiltinExtensionsConfig,
	key: BuiltinExtensionKey,
): boolean {
	return config.enabled[key] ?? true;
}

export function is_builtin_extension_active(
	config: BuiltinExtensionsConfig,
	key: BuiltinExtensionKey,
	force_disabled: ReadonlySet<BuiltinExtensionKey> = new Set(),
): boolean {
	return (
		is_builtin_extension_enabled(config, key) &&
		!force_disabled.has(key)
	);
}

export function resolve_builtin_extension_states(
	force_disabled: ReadonlySet<BuiltinExtensionKey> = new Set(),
	config: BuiltinExtensionsConfig = load_builtin_extensions_config(),
): BuiltinExtensionState[] {
	return BUILTIN_EXTENSIONS.map((extension) => {
		const saved_enabled = is_builtin_extension_enabled(
			config,
			extension.key,
		);
		const forced = force_disabled.has(extension.key);
		return {
			...extension,
			saved_enabled,
			effective_enabled: saved_enabled && !forced,
			forced_disabled: forced,
		};
	});
}

export function find_builtin_extension(
	query: string,
): BuiltinExtensionInfo | undefined {
	const normalized = query.trim().toLowerCase();
	if (!normalized) return undefined;

	return BUILTIN_EXTENSIONS.find((extension) =>
		[extension.key, extension.label, ...extension.aliases].some(
			(value) => value.toLowerCase() === normalized,
		),
	);
}
