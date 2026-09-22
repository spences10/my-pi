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

	it('preserves other package secrets', () => {
		const path = join(
			mkdtempSync(join(tmpdir(), 'pi-talk-')),
			'secrets.json',
		);
		write_talk_secrets({ enabled: true, apiKey: 'secret' }, path);
		const saved = JSON.parse(readFileSync(path, 'utf8')) as {
			packages: Record<string, unknown>;
		};
		saved.packages.other = { token: 'keep' };
		writeFileSync(path, JSON.stringify(saved));
		write_talk_secrets({ enabled: false, apiKey: 'secret' }, path);
		expect(
			(JSON.parse(readFileSync(path, 'utf8')) as typeof saved)
				.packages.other,
		).toEqual({ token: 'keep' });
	});
});
