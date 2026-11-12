import { getAgentDir } from '@earendil-works/pi-coding-agent';
import {
	read_package_settings,
	write_package_settings,
} from '@spences10/pi-settings';
import { join, resolve } from 'node:path';
import * as v from 'valibot';

export interface TelemetryConfig {
	version: number;
	enabled: boolean;
}

const DEFAULT_CONFIG: TelemetryConfig = {
	version: 1,
	enabled: false,
};

const config_schema = v.looseObject({
	version: v.fallback(v.number(), DEFAULT_CONFIG.version),
	enabled: v.fallback(v.boolean(), DEFAULT_CONFIG.enabled),
});

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
		return v.parse(
			config_schema,
			read_package_settings('telemetry', DEFAULT_CONFIG),
		);
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
