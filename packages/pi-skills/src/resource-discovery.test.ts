import { describe, expect, it } from 'vite-plus/test';
import { is_resource_enabled } from './resource-discovery.js';

describe('packages/pi-skills/src/resource-discovery.ts', () => {
	it('loads without side effects', async () => {
		await expect(
			import('./resource-discovery.js'),
		).resolves.toBeDefined();
	});

	it('defaults resources to enabled', () => {
		expect(is_resource_enabled(undefined)).toBe(true);
		expect(is_resource_enabled('')).toBe(true);
	});

	it('recognizes disabled values', () => {
		expect(is_resource_enabled('false')).toBe(false);
		expect(is_resource_enabled('0')).toBe(false);
		expect(is_resource_enabled('disable')).toBe(false);
		expect(is_resource_enabled('yes')).toBe(true);
	});
});
