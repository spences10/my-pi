import { readFileSync } from 'node:fs';
import * as v from 'valibot';

const package_json_schema = v.object({ version: v.string() });

/** Read the my-pi package version from its package.json. */
export function read_package_version(): string {
	return v.parse(
		package_json_schema,
		JSON.parse(
			readFileSync(
				new URL('../package.json', import.meta.url),
				'utf8',
			),
		),
	).version;
}
