import {
	read_package_settings,
	write_package_settings,
} from '@spences10/pi-settings';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type ContextSettingsPreset =
	| 'default'
	| 'light'
	| 'balanced'
	| 'research'
	| 'archive';

export interface ContextOutputLimits {
	max_bytes: number;
	max_lines: number;
}

export interface ContextSettingsValues {
	retention_days: number | null;
	max_mb: number | null;
	purge_on_shutdown: boolean;
	capture_max_bytes: number;
	capture_max_lines: number;
}

export interface ContextSettingsConfig extends ContextSettingsValues {
	version: 1;
	preset: ContextSettingsPreset | 'custom';
}

export interface ContextSettingsPresetDefinition extends ContextSettingsValues {
	label: string;
	description: string;
}

export const DEFAULT_CONTEXT_CAPTURE_MAX_BYTES = 24 * 1024;
export const DEFAULT_CONTEXT_CAPTURE_MAX_LINES = 300;

export const CONTEXT_SETTINGS_PRESETS: Record<
	ContextSettingsPreset,
	ContextSettingsPresetDefinition
> = {
	default: {
		label: 'Default',
		description:
			'7 days, no size cap; capture after 24 KiB / 300 lines',
		retention_days: 7,
		max_mb: null,
		purge_on_shutdown: false,
		capture_max_bytes: DEFAULT_CONTEXT_CAPTURE_MAX_BYTES,
		capture_max_lines: DEFAULT_CONTEXT_CAPTURE_MAX_LINES,
	},
	light: {
		label: 'Light',
		description:
			'1 day, 50 MiB cap; capture after 16 KiB / 200 lines',
		retention_days: 1,
		max_mb: 50,
		purge_on_shutdown: false,
		capture_max_bytes: 16 * 1024,
		capture_max_lines: 200,
	},
	balanced: {
		label: 'Balanced',
		description:
			'7 days, 250 MiB cap; capture after 24 KiB / 300 lines',
		retention_days: 7,
		max_mb: 250,
		purge_on_shutdown: false,
		capture_max_bytes: DEFAULT_CONTEXT_CAPTURE_MAX_BYTES,
		capture_max_lines: DEFAULT_CONTEXT_CAPTURE_MAX_LINES,
	},
	research: {
		label: 'Research',
		description:
			'30 days, 1 GiB cap; capture after 48 KiB / 600 lines',
		retention_days: 30,
		max_mb: 1024,
		purge_on_shutdown: false,
		capture_max_bytes: 48 * 1024,
		capture_max_lines: 600,
	},
	archive: {
		label: 'Archive',
		description:
			'90 days, 5 GiB cap; capture after 64 KiB / 1,000 lines',
		retention_days: 90,
		max_mb: 5120,
		purge_on_shutdown: false,
		capture_max_bytes: 64 * 1024,
		capture_max_lines: 1_000,
	},
};

export const DEFAULT_CONTEXT_SETTINGS: ContextSettingsConfig = {
	version: 1,
	preset: 'default',
	retention_days: CONTEXT_SETTINGS_PRESETS.default.retention_days,
	max_mb: CONTEXT_SETTINGS_PRESETS.default.max_mb,
	purge_on_shutdown:
		CONTEXT_SETTINGS_PRESETS.default.purge_on_shutdown,
	capture_max_bytes:
		CONTEXT_SETTINGS_PRESETS.default.capture_max_bytes,
	capture_max_lines:
		CONTEXT_SETTINGS_PRESETS.default.capture_max_lines,
};

export function get_context_settings_config_path(): string {
	if (process.env.MY_PI_CONTEXT_CONFIG)
		return process.env.MY_PI_CONTEXT_CONFIG;
	const xdg =
		process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
	return join(xdg, 'my-pi', 'context.json');
}

export function context_settings_from_preset(
	preset: ContextSettingsPreset,
): ContextSettingsConfig {
	const definition = CONTEXT_SETTINGS_PRESETS[preset];
	return {
		version: 1,
		preset,
		retention_days: definition.retention_days,
		max_mb: definition.max_mb,
		purge_on_shutdown: definition.purge_on_shutdown,
		capture_max_bytes: definition.capture_max_bytes,
		capture_max_lines: definition.capture_max_lines,
	};
}

export function load_context_settings_config(): ContextSettingsConfig | null {
	const path = get_context_settings_config_path();
	try {
		const parsed = (
			process.env.MY_PI_CONTEXT_CONFIG
				? existsSync(path)
					? JSON.parse(readFileSync(path, 'utf-8'))
					: null
				: read_package_settings<Partial<ContextSettingsConfig> | null>(
						'context',
						null,
					)
		) as Partial<ContextSettingsConfig> | null;
		if (!parsed) return null;
		return normalize_context_settings_config(parsed);
	} catch {
		return null;
	}
}

export function save_context_settings_config(
	config: ContextSettingsConfig,
): void {
	if (!process.env.MY_PI_CONTEXT_CONFIG) {
		write_package_settings('context', config);
		return;
	}
	const path = get_context_settings_config_path();
	const dir = dirname(path);
	if (!existsSync(dir))
		mkdirSync(dir, { recursive: true, mode: 0o700 });

	const tmp = `${path}.tmp-${Date.now()}`;
	writeFileSync(tmp, JSON.stringify(config, null, '\t') + '\n', {
		mode: 0o600,
	});
	renameSync(tmp, path);
}

export function get_context_capture_limits(
	env: NodeJS.ProcessEnv = process.env,
): ContextOutputLimits {
	const saved = load_context_settings_config();
	const fallback = saved ?? DEFAULT_CONTEXT_SETTINGS;
	return {
		max_bytes: parse_positive_byte_env(
			env.MY_PI_CONTEXT_CAPTURE_MAX_KB,
			fallback.capture_max_bytes,
		),
		max_lines: parse_positive_number_env(
			env.MY_PI_CONTEXT_CAPTURE_MAX_LINES,
			fallback.capture_max_lines,
		),
	};
}

export function normalize_context_settings_config(
	value: Partial<ContextSettingsConfig>,
): ContextSettingsConfig {
	const preset = is_context_settings_preset(value.preset)
		? value.preset
		: value.preset === 'custom'
			? 'custom'
			: 'custom';
	const base =
		preset !== 'custom'
			? context_settings_from_preset(preset)
			: DEFAULT_CONTEXT_SETTINGS;

	return {
		version: 1,
		preset,
		retention_days: normalize_optional_positive_number(
			value.retention_days,
			base.retention_days,
		),
		max_mb: normalize_optional_positive_number(
			value.max_mb,
			base.max_mb,
		),
		purge_on_shutdown:
			typeof value.purge_on_shutdown === 'boolean'
				? value.purge_on_shutdown
				: base.purge_on_shutdown,
		capture_max_bytes: normalize_positive_number(
			value.capture_max_bytes,
			base.capture_max_bytes,
		),
		capture_max_lines: normalize_positive_number(
			value.capture_max_lines,
			base.capture_max_lines,
		),
	};
}

export function is_context_settings_preset(
	value: unknown,
): value is ContextSettingsPreset {
	return (
		typeof value === 'string' &&
		Object.hasOwn(CONTEXT_SETTINGS_PRESETS, value)
	);
}

function normalize_optional_positive_number(
	value: unknown,
	fallback: number | null,
): number | null {
	if (value === null) return null;
	if (typeof value !== 'number') return fallback;
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalize_positive_number(
	value: unknown,
	fallback: number,
): number {
	if (typeof value !== 'number') return fallback;
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parse_positive_number_env(
	value: string | undefined,
	fallback: number,
): number {
	if (value === undefined || value.trim() === '') return fallback;
	const parsed = Number(value.trim());
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parse_positive_byte_env(
	value: string | undefined,
	fallback: number,
): number {
	const kb = parse_positive_number_env(value, fallback / 1024);
	return Math.round(kb * 1024);
}
