import { describe, expect, it } from 'vitest';
import {
	describe_working_indicator_mode,
	parse_working_indicator_mode,
} from './index.js';

describe('parse_working_indicator_mode', () => {
	it('accepts named modes', () => {
		expect(parse_working_indicator_mode('dot')).toBe('dot');
		expect(parse_working_indicator_mode('none')).toBe('none');
	});

	it('maps reset and default to default mode', () => {
		expect(parse_working_indicator_mode('reset')).toBe('default');
		expect(parse_working_indicator_mode('default')).toBe('default');
	});

	it('rejects invalid values', () => {
		expect(parse_working_indicator_mode('')).toBe(null);
		expect(parse_working_indicator_mode('ellipsis')).toBe(null);
		expect(parse_working_indicator_mode('weird')).toBe(null);
	});
});

describe('describe_working_indicator_mode', () => {
	it('formats human-readable labels', () => {
		expect(describe_working_indicator_mode('dot')).toBe('static dot');
		expect(describe_working_indicator_mode('none')).toBe('hidden');
		expect(describe_working_indicator_mode('default')).toBe(
			'pi default spinner',
		);
	});
});
