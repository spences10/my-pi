import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	MINIMUM_NODE_VERSION,
	get_node_preflight_error,
	is_supported_node_version,
} from './runtime-preflight.js';

describe('Node runtime preflight', () => {
	it('accepts the minimum supported Node version', () => {
		expect(is_supported_node_version('24.15.0')).toBe(true);
		expect(get_node_preflight_error('24.15.0')).toBeUndefined();
	});

	it('rejects the immediately lower Node version', () => {
		expect(is_supported_node_version('24.14.0')).toBe(false);
		expect(get_node_preflight_error('24.14.0')).toBe(
			'my-pi requires Node >=24.15.0; current version is 24.14.0. Upgrade Node and retry.',
		);
	});

	it('stays aligned with the package engine requirement', () => {
		const package_json = JSON.parse(
			readFileSync('package.json', 'utf-8'),
		) as { engines?: { node?: string } };
		expect(package_json.engines?.node).toBe(
			`>=${MINIMUM_NODE_VERSION}`,
		);
	});
});
