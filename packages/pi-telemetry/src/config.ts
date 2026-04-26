import { getAgentDir } from '@mariozechner/pi-coding-agent';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface TelemetryConfig {
	version: number;
	enabled: boolean;
}

const DEFAULT_CONFIG: TelemetryConfig = {
	version: 1,
	enabled: false,
};

export function get_telemetry_config_path(): string {
	return join(getAgentDir(), 'telemetry.json');
}

export function get_default_telemetry_db_path(): string {
	return join(getAgentDir(), 'telemetry.db');
}

export function resolve_telemetry_db_path(
	cwd: string,
	override_path?: string,
): string {
	if (!override_path) return get_default_telemetry_db_path();
	return resolve(cwd, override_path);
}

export function load_telemetry_config(): TelemetryConfig {
	const path = get_telemetry_config_path();
	if (!existsSync(path)) return { ...DEFAULT_CONFIG };

	try {
		const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
			version?: unknown;
			enabled?: unknown;
		};
		return {
			version:
				typeof parsed.version === 'number'
					? parsed.version
					: DEFAULT_CONFIG.version,
			enabled:
				typeof parsed.enabled === 'boolean'
					? parsed.enabled
					: DEFAULT_CONFIG.enabled,
		};
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

export function save_telemetry_config(config: TelemetryConfig): void {
	const path = get_telemetry_config_path();
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

export function resolve_telemetry_enabled(
	config: TelemetryConfig = load_telemetry_config(),
	override?: boolean,
): boolean {
	return override ?? config.enabled;
}
