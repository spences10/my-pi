import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type BuiltinExtensionKey } from '../extensions/builtin-registry.js';

export interface LegacyBuiltinExtensionsConfig {
	version?: number;
	enabled?: Partial<Record<BuiltinExtensionKey, boolean>>;
}

export interface LegacySettingsFiles {
	extensions?: {
		path: string;
		config: LegacyBuiltinExtensionsConfig;
	};
}

export function get_legacy_builtin_extensions_config_path(): string {
	const xdg =
		process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
	return join(xdg, 'my-pi', 'extensions.json');
}

function read_json_file<T>(path: string): T | undefined {
	if (!existsSync(path)) return undefined;
	return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

export function find_legacy_settings_files(): LegacySettingsFiles {
	const extensions_path = get_legacy_builtin_extensions_config_path();
	const extensions =
		read_json_file<LegacyBuiltinExtensionsConfig>(extensions_path);

	if (!extensions) return {};
	return {
		extensions: { path: extensions_path, config: extensions },
	};
}

export function has_legacy_settings_files(): boolean {
	return Object.keys(find_legacy_settings_files()).length > 0;
}
