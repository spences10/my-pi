import {
	read_settings,
	write_settings,
} from '@spences10/pi-settings';

/** Extensions are enabled unless saved as `false`. */
export function is_enabled(key: string): boolean {
	return read_settings().extensions?.enabled?.[key] !== false;
}

export function set_enabled(key: string, enabled: boolean): void {
	const settings = read_settings();
	write_settings({
		...settings,
		extensions: {
			...settings.extensions,
			enabled: { ...settings.extensions?.enabled, [key]: enabled },
		},
	});
}
