import { describe, expect, it } from 'vitest';
import { clean_name, is_transient_error } from './index.js';

describe('clean_name', () => {
	it('normalises to kebab-case', () => {
		expect(clean_name('Fix Auth Bug!')).toBe('fix-auth-bug');
	});

	it('strips quotes and diacritics', () => {
		expect(clean_name('"Café deploy"')).toBe('cafe-deploy');
	});

	it('caps length at 50 chars without trailing dashes', () => {
		const name = clean_name(`${'word '.repeat(20)}end`);
		expect(name.length).toBeLessThanOrEqual(50);
		expect(name.endsWith('-')).toBe(false);
	});

	it('returns empty string for unusable input', () => {
		expect(clean_name('!!!')).toBe('');
	});
});

describe('is_transient_error', () => {
	it('matches the kimi 429 overload payload', () => {
		expect(
			is_transient_error(
				'Error: 429 {"error":{"type":"rate_limit_error","message":"The engine is currently overloaded, please try again later"}}',
			),
		).toBe(true);
	});

	it('matches transient 5xx statuses', () => {
		expect(is_transient_error('503 Service Unavailable')).toBe(true);
		expect(is_transient_error('502 Bad Gateway')).toBe(true);
	});

	it('rejects permanent errors', () => {
		expect(is_transient_error('No credentials for kimi-coding')).toBe(
			false,
		);
		expect(is_transient_error('401 Unauthorized')).toBe(false);
	});
});
