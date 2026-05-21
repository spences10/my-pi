import {
	current_settings_exists,
	ensure_current_settings,
	read_current_settings,
	write_current_settings,
} from './current.js';
import { has_legacy_settings_files } from './legacy.js';
import { migrate_legacy_settings } from './migrate.js';
import type { MyPiSettings } from './schema.js';

export { get_settings_path } from './current.js';
export { migrate_legacy_settings } from './migrate.js';
export type { MyPiSettings } from './schema.js';

export function load_settings(): MyPiSettings {
	if (!current_settings_exists() && has_legacy_settings_files()) {
		return migrate_legacy_settings().settings;
	}
	return ensure_current_settings();
}

export function save_settings(settings: MyPiSettings): void {
	write_current_settings(settings);
}

export function update_settings(
	updater: (settings: MyPiSettings) => MyPiSettings,
): MyPiSettings {
	const next = updater(read_current_settings());
	write_current_settings(next);
	return next;
}
