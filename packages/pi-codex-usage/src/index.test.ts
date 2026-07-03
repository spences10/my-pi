import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	format_codex_usage_status,
	get_codex_usage_tone,
	is_codex_provider,
	parse_codex_usage_response,
	read_codex_access_token,
} from './index.js';

describe('is_codex_provider', () => {
	it('only matches the OpenAI Codex provider', () => {
		expect(is_codex_provider('openai-codex')).toBe(true);
		expect(is_codex_provider('openai')).toBe(false);
		expect(is_codex_provider(undefined)).toBe(false);
	});
});

describe('parse_codex_usage_response', () => {
	it('parses the known Codex usage payload shape', () => {
		expect(
			parse_codex_usage_response({
				plan_type: 'pro',
				rate_limit: {
					allowed: true,
					limit_reached: false,
					primary_window: { used_percent: 0, reset_at: 1783084186 },
					secondary_window: {
						used_percent: 11,
						reset_at: 1783413686,
					},
				},
				rate_limit_reset_credits: { available_count: 4 },
			}),
		).toEqual({
			planType: 'pro',
			primaryUsedPercent: 0,
			primaryResetAtSeconds: 1783084186,
			secondaryUsedPercent: 11,
			secondaryResetAtSeconds: 1783413686,
			resetCredits: 4,
		});
	});

	it('rejects payloads without primary usage', () => {
		expect(parse_codex_usage_response({})).toBeNull();
		expect(
			parse_codex_usage_response({
				rate_limit: { primary_window: { used_percent: '0' } },
			}),
		).toBeNull();
	});
});

describe('format_codex_usage_status', () => {
	it('formats compact primary and secondary windows', () => {
		expect(
			format_codex_usage_status(
				{
					primaryUsedPercent: 0,
					primaryResetAtSeconds: 1_000 + 5 * 60 * 60,
					secondaryUsedPercent: 11,
					secondaryResetAtSeconds: 1_000 + 7 * 24 * 60 * 60,
				},
				1_000_000,
			),
		).toBe('cx 5h 0% · 7d 11%');
	});

	it('formats without reset times', () => {
		expect(
			format_codex_usage_status({
				primaryUsedPercent: 42.4,
				secondaryUsedPercent: 80.1,
			}),
		).toBe('cx 42% · 80%');
	});
});

describe('get_codex_usage_tone', () => {
	it('reports dim, warning, and error thresholds', () => {
		expect(get_codex_usage_tone({ primaryUsedPercent: 79 })).toBe(
			'dim',
		);
		expect(get_codex_usage_tone({ primaryUsedPercent: 80 })).toBe(
			'warning',
		);
		expect(get_codex_usage_tone({ primaryUsedPercent: 100 })).toBe(
			'error',
		);
		expect(
			get_codex_usage_tone({
				primaryUsedPercent: 0,
				secondaryUsedPercent: 90,
			}),
		).toBe('warning');
	});
});

describe('read_codex_access_token', () => {
	it('reads a fake token from an auth file', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'pi-codex-usage-'));
		const auth_path = join(dir, 'auth.json');
		await writeFile(
			auth_path,
			JSON.stringify({ 'openai-codex': { access: 'fake-token' } }),
		);

		await expect(read_codex_access_token(auth_path)).resolves.toBe(
			'fake-token',
		);
	});

	it('returns null when auth is missing or malformed', async () => {
		await expect(
			read_codex_access_token('/missing/auth.json'),
		).resolves.toBeNull();
		const dir = await mkdtemp(join(tmpdir(), 'pi-codex-usage-'));
		const auth_path = join(dir, 'auth.json');
		await writeFile(auth_path, '{');
		await expect(
			read_codex_access_token(auth_path),
		).resolves.toBeNull();
	});
});
