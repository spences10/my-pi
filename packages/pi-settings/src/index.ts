import { getAgentDir } from '@earendil-works/pi-coding-agent';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export interface MyPiSettingsFile {
	version: 1;
	extensions?: { enabled?: Record<string, boolean> };
	mcp?: { policy?: unknown };
	codingPreferences?: unknown;
	promptPresets?: { global?: unknown; state?: unknown };
	trust?: Record<string, unknown>;
	packages?: Record<string, unknown>;
}

export function get_settings_path(): string {
	return join(getAgentDir(), 'my-pi-settings.json');
}

function default_settings(): MyPiSettingsFile {
	return {
		version: 1,
		extensions: { enabled: {} },
		trust: {},
		packages: {},
	};
}

export function read_settings(): MyPiSettingsFile {
	const path = get_settings_path();
	if (!existsSync(path)) return default_settings();
	return {
		...default_settings(),
		...JSON.parse(readFileSync(path, 'utf-8')),
	};
}

export function write_settings(settings: MyPiSettingsFile): void {
	const path = get_settings_path();
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const tmp = `${path}.tmp-${Date.now()}`;
	writeFileSync(
		tmp,
		JSON.stringify({ ...settings, version: 1 }, null, '\t') + '\n',
		{ mode: 0o600 },
	);
	renameSync(tmp, path);
}

export function extract_input_strings(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	if (Array.isArray(value))
		return value.flatMap(extract_input_strings);
	if (!value || typeof value !== 'object') return [];
	return Object.values(value as Record<string, unknown>).flatMap(
		extract_input_strings,
	);
}

export function read_settings_section<T>(
	key: keyof MyPiSettingsFile,
	fallback: T,
): T {
	const settings = read_settings();
	return (
		settings[key] === undefined ? fallback : settings[key]
	) as T;
}

export function read_package_settings<T>(
	name: string,
	fallback: T,
): T {
	const packages = read_settings().packages ?? {};
	return (
		packages[name] === undefined ? fallback : packages[name]
	) as T;
}

export function write_package_settings<T>(
	name: string,
	value: T,
): void {
	const settings = read_settings();
	write_settings({
		...settings,
		packages: { ...settings.packages, [name]: value },
	});
}

export function read_trust_settings<T>(name: string, fallback: T): T {
	const trust = read_settings().trust ?? {};
	return (trust[name] === undefined ? fallback : trust[name]) as T;
}

export function write_trust_settings<T>(
	name: string,
	value: T,
): void {
	const settings = read_settings();
	write_settings({
		...settings,
		trust: { ...settings.trust, [name]: value },
	});
}
