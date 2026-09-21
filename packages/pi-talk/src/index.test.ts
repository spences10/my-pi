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
	forget_talk_secrets,
	HoldSpace,
	read_talk_secrets,
	write_talk_secrets,
} from './index.js';

function setup() {
	const callbacks = {
		on_tap: vi.fn(),
		on_legacy_press: vi.fn(),
		on_start: vi.fn(),
		on_stop: vi.fn(),
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

describe('HoldSpace', () => {
	it('inserts one space for a quick tap', () => {
		vi.useFakeTimers();
		const { hold, callbacks } = setup();
		expect(hold.handle('\u001b[32u')).toBe(true);
		vi.advanceTimersByTime(100);
		expect(hold.handle('\u001b[32;1:3u')).toBe(true);
		expect(callbacks.on_tap).toHaveBeenCalledOnce();
		expect(callbacks.on_start).not.toHaveBeenCalled();
	});

	it('starts after a hold and stops on release without inserting spaces', () => {
		vi.useFakeTimers();
		const { hold, callbacks } = setup();
		hold.handle('\u001b[32u');
		vi.advanceTimersByTime(300);
		expect(callbacks.on_start).toHaveBeenCalledWith(false);
		hold.handle('\u001b[32;1:3u');
		expect(callbacks.on_stop).toHaveBeenCalledOnce();
		expect(callbacks.on_tap).not.toHaveBeenCalled();
	});

	it('consumes repeat events during a hold', () => {
		vi.useFakeTimers();
		const { hold, callbacks } = setup();
		hold.handle('\u001b[32u');
		expect(hold.handle('\u001b[32;1:2u')).toBe(true);
		vi.advanceTimersByTime(300);
		expect(callbacks.on_start).toHaveBeenCalledOnce();
		expect(callbacks.on_tap).not.toHaveBeenCalled();
	});

	it('leaves a normal legacy tap alone and consumes a held repeat', () => {
		vi.useFakeTimers();
		const { hold, callbacks } = setup();
		expect(hold.handle(' ')).toBe(false);
		expect(callbacks.on_legacy_press).toHaveBeenCalledOnce();
		expect(callbacks.on_start).not.toHaveBeenCalled();

		expect(hold.handle(' ')).toBe(true);
		expect(callbacks.on_start).toHaveBeenCalledWith(true);
		vi.advanceTimersByTime(180);
		expect(callbacks.on_stop).toHaveBeenCalledOnce();
	});
});
