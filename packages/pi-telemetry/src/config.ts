import { getAgentDir } from '@earendil-works/pi-coding-agent';
import {
	read_package_settings,
	write_package_settings,
} from '@spences10/pi-settings';
import { join, resolve } from 'node:path';

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
	try {
		const parsed = read_package_settings(
			'telemetry',
			DEFAULT_CONFIG,
		) as {
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
	write_package_settings('telemetry', config);
}

export function resolve_telemetry_enabled(
	config: TelemetryConfig = load_telemetry_config(),
	override?: boolean,
): boolean {
	return override ?? config.enabled;
}
