import {
	mkdtempSync,
	readFileSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import {
	forget_talk_secrets,
	read_talk_secrets,
	write_talk_secrets,
} from './secrets.js';

describe('Talk secrets', () => {
	it('is disabled by default', () => {
		const path = join(
			mkdtempSync(join(tmpdir(), 'pi-talk-')),
			'secrets.json',
		);

		expect(read_talk_secrets(path)).toEqual({
			enabled: false,
			apiKey: undefined,
		});
	});

	it('stores the key with private permissions and can forget it', () => {
		const path = join(
			mkdtempSync(join(tmpdir(), 'pi-talk-')),
			'secrets.json',
		);

		write_talk_secrets({ enabled: true, apiKey: 'secret' }, path);
		expect(read_talk_secrets(path)).toEqual({
			enabled: true,
			apiKey: 'secret',
		});
		expect(statSync(path).mode & 0o777).toBe(0o600);
		forget_talk_secrets(path);
		expect(read_talk_secrets(path).enabled).toBe(false);
	});

	it.each([
		{
			stored: { enabled: true, deepgramApiKey: 123 },
			expected: { enabled: true, apiKey: undefined },
		},
		{
			stored: { enabled: 'true', deepgramApiKey: 'secret' },
			expected: { enabled: false, apiKey: 'secret' },
		},
		{
			stored: null,
			expected: { enabled: false, apiKey: undefined },
		},
	])(
		'handles invalid stored fields: $stored',
		({ stored, expected }) => {
			const path = join(
				mkdtempSync(join(tmpdir(), 'pi-talk-')),
				'secrets.json',
			);

			writeFileSync(
				path,
				JSON.stringify({
					version: 1,
					packages: { 'pi-talk': stored },
				}),
			);
			expect(read_talk_secrets(path)).toEqual(expected);
		},
	);

	it('preserves other package secrets', () => {
		const path = join(
			mkdtempSync(join(tmpdir(), 'pi-talk-')),
			'secrets.json',
		);

		const saved = {
			version: 1,
			packages: {
				'pi-talk': { enabled: true, deepgramApiKey: 'secret' },
				other: { token: 'keep' },
			},
		};

		writeFileSync(path, JSON.stringify(saved));
		write_talk_secrets({ enabled: false, apiKey: 'secret' }, path);
		expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
			...saved,
			packages: {
				...saved.packages,
				'pi-talk': { enabled: false, deepgramApiKey: 'secret' },
			},
		});

		forget_talk_secrets(path);
		expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
			version: 1,
			packages: { other: { token: 'keep' } },
		});
	});
});
