import { getAgentDir } from '@mariozechner/pi-coding-agent';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export type WorkingIndicatorMode = 'default' | 'dot' | 'none';

export interface WorkingIndicatorConfig {
	version: number;
	mode: WorkingIndicatorMode;
}

const DEFAULT_CONFIG: WorkingIndicatorConfig = {
	version: 1,
	mode: 'default',
};

export function get_working_indicator_config_path(): string {
	return join(getAgentDir(), 'working-indicator.json');
}

export function load_working_indicator_config(): WorkingIndicatorConfig {
	const path = get_working_indicator_config_path();
	if (!existsSync(path)) return { ...DEFAULT_CONFIG };

	try {
		const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
			version?: unknown;
			mode?: unknown;
		};
		return {
			version:
				typeof parsed.version === 'number'
					? parsed.version
					: DEFAULT_CONFIG.version,
			mode: is_working_indicator_mode(parsed.mode)
				? parsed.mode
				: DEFAULT_CONFIG.mode,
		};
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

export function save_working_indicator_config(
	config: WorkingIndicatorConfig,
): void {
	const path = get_working_indicator_config_path();
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

export function is_working_indicator_mode(
	value: unknown,
): value is WorkingIndicatorMode {
	return value === 'default' || value === 'dot' || value === 'none';
}
