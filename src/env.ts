import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function load_env(cwd: string) {
	const env_path = join(cwd, '.env');
	if (!existsSync(env_path)) return;

	const content = readFileSync(env_path, 'utf-8');
	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;

		const eq = trimmed.indexOf('=');
		if (eq === -1) continue;

		const key = trimmed.slice(0, eq).trim();
		let val = trimmed.slice(eq + 1).trim();

		// Strip surrounding quotes
		if (
			(val.startsWith('"') && val.endsWith('"')) ||
			(val.startsWith("'") && val.endsWith("'"))
		) {
			val = val.slice(1, -1);
		}

		// Don't override existing env vars
		if (!(key in process.env)) {
			process.env[key] = val;
		}
	}
}
