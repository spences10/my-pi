import { describe, expect, it } from 'vite-plus/test';
import { test_theme } from '../test-utils.js';
import { error, muted, themed_text, warning } from './tokens.js';

describe('footer theme tokens', () => {
	it('maps footer tones onto active theme values', () => {
		expect(themed_text(test_theme, 'muted', 'text')).toBe(
			'<dim>text</dim>',
		);
		expect(themed_text(test_theme, 'balanced', 'text')).toBe('text');
		expect(themed_text(test_theme, 'bright', 'text')).toBe(
			'<accent>text</accent>',
		);
	});

	it('exposes urgency helpers', () => {
		expect(muted(test_theme, 'x')).toBe('<dim>x</dim>');
		expect(warning(test_theme, 'x')).toBe('<warning>x</warning>');
		expect(error(test_theme, 'x')).toBe('<error>x</error>');
	});
});
