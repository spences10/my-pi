import { describe, expect, expectTypeOf, it } from 'vitest';
import * as footer from './index.js';
import type {
	FooterDensity,
	FooterPreset,
	FooterStatusAlignment,
	FooterStatusLayout,
	FooterStatusPlacement,
	FooterTheme,
	FooterTone,
	FooterWidget,
} from './index.js';

const DOCUMENTED_RUNTIME_EXPORTS = [
	'FOOTER_COLORS',
	'FOOTER_DENSITIES',
	'FOOTER_PRESETS',
	'FOOTER_RESEARCH_REFERENCES',
	'FOOTER_STATUS_ALIGNMENTS',
	'FOOTER_TONES',
	'FOOTER_WIDGETS',
	'default',
	'get_current_thinking_level',
	'get_default_footer_thinking_level',
	'render_footer_lines',
	'render_footer_status_line',
	'render_footer_three_column_line',
] as const;

describe('@spences10/pi-footer public API', () => {
	it('keeps the documented runtime exports available from the package root', () => {
		expect(Object.keys(footer).sort()).toEqual(
			[...DOCUMENTED_RUNTIME_EXPORTS].sort(),
		);
		expect(footer.default).toBeTypeOf('function');
	});

	it('keeps the documented configuration and theme types available', () => {
		expectTypeOf<FooterDensity>().toMatchTypeOf<
			'compact' | 'comfortable' | 'expanded'
		>();
		expectTypeOf<FooterPreset>().toMatchTypeOf<
			'minimal' | 'default' | 'power' | 'git-heavy'
		>();
		expectTypeOf<FooterStatusAlignment>().toMatchTypeOf<
			'left' | 'center' | 'right'
		>();
		expectTypeOf<FooterStatusLayout>().toMatchTypeOf<
			Record<string, FooterStatusPlacement>
		>();
		expectTypeOf<FooterTheme>().toHaveProperty('fg');
		expectTypeOf<FooterTone>().toMatchTypeOf<
			'muted' | 'balanced' | 'bright'
		>();
		expectTypeOf<FooterWidget>().toMatchTypeOf<string>();
	});
});
