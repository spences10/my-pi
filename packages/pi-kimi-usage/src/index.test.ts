import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	format_kimi_usage_status,
	get_kimi_usage_tone,
	is_kimi_provider,
	parse_kimi_usage_response,
	read_kimi_credential,
} from './index.js';

// Shape captured from a live GET https://api.kimi.com/coding/v1/usages
// response on 2026-08-05.
const LIVE_PAYLOAD = {
	user: {
		userId: 'd6f138ptoomdk5m8g74g',
		region: 'REGION_OVERSEA',
		membership: { level: 'LEVEL_INTERMEDIATE' },
		businessId: '',
	},
	usage: {
		limit: '100',
		used: '4',
		remaining: '96',
		resetTime: '2026-08-10T20:58:58.513336Z',
	},
	limits: [
		{
			window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
			detail: {
				limit: '100',
				used: '7',
				remaining: '93',
				resetTime: '2026-08-05T17:58:58.513336Z',
			},
		},
	],
	parallel: { limit: '20' },
	authentication: {
		method: 'METHOD_ACCESS_TOKEN',
		scope: 'FEATURE_CODING',
	},
};

describe('is_kimi_provider', () => {
	it('only matches the Kimi For Coding provider', () => {
		expect(is_kimi_provider('kimi-coding')).toBe(true);
		expect(is_kimi_provider('moonshotai')).toBe(false);
		expect(is_kimi_provider(undefined)).toBe(false);
	});
});

describe('parse_kimi_usage_response', () => {
	it('parses the live payload shape', () => {
		expect(parse_kimi_usage_response(LIVE_PAYLOAD)).toEqual({
			membershipLevel: 'intermediate',
			primary: {
				usedPercent: 7,
				resetAtSeconds: Math.floor(
					Date.parse('2026-08-05T17:58:58.513336Z') / 1000,
				),
			},
			secondary: {
				usedPercent: 4,
				resetAtSeconds: Math.floor(
					Date.parse('2026-08-10T20:58:58.513336Z') / 1000,
				),
			},
		});
	});

	it('computes used percent from non-100 limits', () => {
		const snapshot = parse_kimi_usage_response({
			usage: { limit: '500', used: '250' },
			limits: [],
		});
		expect(snapshot?.primary.usedPercent).toBe(50);
		expect(snapshot?.secondary).toBeUndefined();
	});

	it('picks the shortest rolling window as primary', () => {
		const snapshot = parse_kimi_usage_response({
			usage: { limit: '100', used: '10' },
			limits: [
				{
					window: { duration: 7, timeUnit: 'TIME_UNIT_DAY' },
					detail: { limit: '100', used: '60' },
				},
				{
					window: { duration: 5, timeUnit: 'TIME_UNIT_HOUR' },
					detail: { limit: '100', used: '30' },
				},
			],
		});
		expect(snapshot?.primary.usedPercent).toBe(30);
		expect(snapshot?.secondary?.usedPercent).toBe(10);
	});

	it('rejects payloads without usable quota data', () => {
		expect(parse_kimi_usage_response({})).toBeNull();
		expect(
			parse_kimi_usage_response({ usage: { limit: '0', used: '0' } }),
		).toBeNull();
		expect(
			parse_kimi_usage_response({ usage: { limit: '100' } }),
		).toBeNull();
	});
});

describe('format_kimi_usage_status', () => {
	it('formats compact primary and secondary windows', () => {
		expect(
			format_kimi_usage_status(
				{
					primary: {
						usedPercent: 7,
						resetAtSeconds: 1_000 + 5 * 60 * 60,
					},
					secondary: {
						usedPercent: 4,
						resetAtSeconds: 1_000 + 5 * 24 * 60 * 60,
					},
				},
				1_000_000,
			),
		).toBe('kimi 5h 7% · 5d 4%');
	});

	it('formats without reset times and secondary window', () => {
		expect(
			format_kimi_usage_status({
				primary: { usedPercent: 42.4 },
			}),
		).toBe('kimi 42%');
	});
});

describe('get_kimi_usage_tone', () => {
	it('reports dim, warning, and error thresholds', () => {
		expect(
			get_kimi_usage_tone({ primary: { usedPercent: 79 } }),
		).toBe('dim');
		expect(
			get_kimi_usage_tone({ primary: { usedPercent: 80 } }),
		).toBe('warning');
		expect(
			get_kimi_usage_tone({ primary: { usedPercent: 100 } }),
		).toBe('error');
		expect(
			get_kimi_usage_tone({
				primary: { usedPercent: 0 },
				secondary: { usedPercent: 90 },
			}),
		).toBe('warning');
	});
});

describe('read_kimi_credential', () => {
	it('reads an OAuth access token', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'pi-kimi-usage-'));
		const auth_path = join(dir, 'auth.json');
		await writeFile(
			auth_path,
			JSON.stringify({
				'kimi-coding': {
					type: 'oauth',
					access: 'fake-access',
					refresh: 'fake-refresh',
					expires: 1,
				},
			}),
		);

		await expect(read_kimi_credential(auth_path, {})).resolves.toBe(
			'fake-access',
		);
	});

	it('reads an API key entry', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'pi-kimi-usage-'));
		const auth_path = join(dir, 'auth.json');
		await writeFile(
			auth_path,
			JSON.stringify({
				'kimi-coding': { type: 'api_key', key: 'sk-kimi-fake' },
			}),
		);

		await expect(read_kimi_credential(auth_path, {})).resolves.toBe(
			'sk-kimi-fake',
		);
	});

	it('falls back to KIMI_API_KEY when auth is missing', async () => {
		await expect(
			read_kimi_credential('/missing/auth.json', {
				KIMI_API_KEY: 'sk-kimi-env',
			}),
		).resolves.toBe('sk-kimi-env');
	});

	it('prefers auth.json over the environment', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'pi-kimi-usage-'));
		const auth_path = join(dir, 'auth.json');
		await writeFile(
			auth_path,
			JSON.stringify({
				'kimi-coding': { type: 'api_key', key: 'sk-kimi-file' },
			}),
		);

		await expect(
			read_kimi_credential(auth_path, {
				KIMI_API_KEY: 'sk-kimi-env',
			}),
		).resolves.toBe('sk-kimi-file');
	});

	it('returns null when nothing is available', async () => {
		await expect(
			read_kimi_credential('/missing/auth.json', {}),
		).resolves.toBeNull();
		const dir = await mkdtemp(join(tmpdir(), 'pi-kimi-usage-'));
		const auth_path = join(dir, 'auth.json');
		await writeFile(auth_path, '{');
		await expect(
			read_kimi_credential(auth_path, {}),
		).resolves.toBeNull();
	});
});
