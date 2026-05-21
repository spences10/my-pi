import { getAgentDir } from '@earendil-works/pi-coding-agent';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
	DEFAULT_SETTINGS,
	normalize_settings,
	type MyPiSettings,
} from './schema.js';

export function get_settings_path(): string {
	return join(getAgentDir(), 'my-pi-settings.json');
}

export function current_settings_exists(): boolean {
	return existsSync(get_settings_path());
}

export function read_current_settings(): MyPiSettings {
	const path = get_settings_path();
	if (!existsSync(path)) return { ...DEFAULT_SETTINGS };
	return normalize_settings(JSON.parse(readFileSync(path, 'utf-8')));
}

export function write_current_settings(settings: MyPiSettings): void {
	const path = get_settings_path();
	const dir = dirname(path);
	if (!existsSync(dir))
		mkdirSync(dir, { recursive: true, mode: 0o700 });

	const tmp = `${path}.tmp-${Date.now()}`;
	writeFileSync(tmp, JSON.stringify(settings, null, '\t') + '\n', {
		mode: 0o600,
	});
	renameSync(tmp, path);
}

export function ensure_current_settings(): MyPiSettings {
	if (!current_settings_exists())
		write_current_settings(DEFAULT_SETTINGS);
	return read_current_settings();
}
