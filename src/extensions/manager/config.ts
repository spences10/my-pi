import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
	BUILTIN_EXTENSIONS,
	type BuiltinExtensionInfo,
	type BuiltinExtensionKey,
} from '../builtin-registry.js';

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

const DEFAULT_CONFIG: BuiltinExtensionsConfig = {
	version: 1,
	enabled: {},
};

export function get_builtin_extensions_config_path(): string {
	const xdg =
		process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
	return join(xdg, 'my-pi', 'extensions.json');
}

export function load_builtin_extensions_config(): BuiltinExtensionsConfig {
	const path = get_builtin_extensions_config_path();
	if (!existsSync(path)) return { ...DEFAULT_CONFIG };

	try {
		const raw = readFileSync(path, 'utf-8');
		const parsed = JSON.parse(
			raw,
		) as Partial<BuiltinExtensionsConfig>;
		const enabled: BuiltinExtensionsConfig['enabled'] = {};
		for (const extension of BUILTIN_EXTENSIONS) {
			const value = parsed.enabled?.[extension.key];
			if (typeof value === 'boolean') {
				enabled[extension.key] = value;
			}
		}

		return {
			version: parsed.version ?? 1,
			enabled,
		};
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

export function save_builtin_extensions_config(
	config: BuiltinExtensionsConfig,
): void {
	const path = get_builtin_extensions_config_path();
	const dir = dirname(path);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}

	const tmp = `${path}.tmp-${Date.now()}`;
	writeFileSync(tmp, JSON.stringify(config, null, '\t') + '\n', {
		mode: 0o600,
	});
	renameSync(tmp, path);
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
