import {
	mkdtempSync,
	readFileSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import {
	forgetTalkSecrets,
	HoldSpace,
	readTalkSecrets,
	writeTalkSecrets,
} from './index.js';

function setup() {
	const callbacks = {
		onTap: vi.fn(),
		onLegacyPress: vi.fn(),
		onStart: vi.fn(),
		onStop: vi.fn(),
	};
	return { hold: new HoldSpace(callbacks), callbacks };
}

afterEach(() => vi.useRealTimers());

describe('Talk secrets', () => {
	it('is disabled by default', () => {
		const path = join(
			mkdtempSync(join(tmpdir(), 'pi-talk-')),
			'secrets.json',
		);
		expect(readTalkSecrets(path)).toEqual({
			enabled: false,
			apiKey: undefined,
		});
	});

	it('stores the key with private permissions and can forget it', () => {
		const path = join(
			mkdtempSync(join(tmpdir(), 'pi-talk-')),
			'secrets.json',
		);
		writeTalkSecrets({ enabled: true, apiKey: 'secret' }, path);
		expect(readTalkSecrets(path)).toEqual({
			enabled: true,
			apiKey: 'secret',
		});
		expect(statSync(path).mode & 0o777).toBe(0o600);
		forgetTalkSecrets(path);
		expect(readTalkSecrets(path).enabled).toBe(false);
	});

	it('preserves other package secrets', () => {
		const path = join(
			mkdtempSync(join(tmpdir(), 'pi-talk-')),
			'secrets.json',
		);
		writeTalkSecrets({ enabled: true, apiKey: 'secret' }, path);
		const saved = JSON.parse(readFileSync(path, 'utf8')) as {
			packages: Record<string, unknown>;
		};
		saved.packages.other = { token: 'keep' };
		writeFileSync(path, JSON.stringify(saved));
		writeTalkSecrets({ enabled: false, apiKey: 'secret' }, path);
		expect(
			(JSON.parse(readFileSync(path, 'utf8')) as typeof saved)
				.packages.other,
		).toEqual({ token: 'keep' });
	});
});

describe('HoldSpace', () => {
	it('inserts one space for a quick tap', () => {
		vi.useFakeTimers();
		const { hold, callbacks } = setup();
		expect(hold.handle('\u001b[32u')).toBe(true);
		vi.advanceTimersByTime(100);
		expect(hold.handle('\u001b[32;1:3u')).toBe(true);
		expect(callbacks.onTap).toHaveBeenCalledOnce();
		expect(callbacks.onStart).not.toHaveBeenCalled();
	});

	it('starts after a hold and stops on release without inserting spaces', () => {
		vi.useFakeTimers();
		const { hold, callbacks } = setup();
		hold.handle('\u001b[32u');
		vi.advanceTimersByTime(300);
		expect(callbacks.onStart).toHaveBeenCalledWith(false);
		hold.handle('\u001b[32;1:3u');
		expect(callbacks.onStop).toHaveBeenCalledOnce();
		expect(callbacks.onTap).not.toHaveBeenCalled();
	});

	it('consumes repeat events during a hold', () => {
		vi.useFakeTimers();
		const { hold, callbacks } = setup();
		hold.handle('\u001b[32u');
		expect(hold.handle('\u001b[32;1:2u')).toBe(true);
		vi.advanceTimersByTime(300);
		expect(callbacks.onStart).toHaveBeenCalledOnce();
		expect(callbacks.onTap).not.toHaveBeenCalled();
	});

	it('leaves a normal legacy tap alone and consumes a held repeat', () => {
		vi.useFakeTimers();
		const { hold, callbacks } = setup();
		expect(hold.handle(' ')).toBe(false);
		expect(callbacks.onLegacyPress).toHaveBeenCalledOnce();
		expect(callbacks.onStart).not.toHaveBeenCalled();

		expect(hold.handle(' ')).toBe(true);
		expect(callbacks.onStart).toHaveBeenCalledWith(true);
		vi.advanceTimersByTime(180);
		expect(callbacks.onStop).toHaveBeenCalledOnce();
	});
});
