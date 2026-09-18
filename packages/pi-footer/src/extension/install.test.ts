import { describe, expect, it, vi } from 'vite-plus/test';
import { DEFAULT_FOOTER_STATE } from '../presets/types.js';
import {
	make_context,
	make_footer_data,
	test_theme,
} from '../test-utils.js';
import { install_footer } from './install.js';

describe('install_footer', () => {
	it('does nothing without UI', () => {
		const set_footer = vi.fn();
		const ctx = make_context({
			hasUI: false,
			ui: { setFooter: set_footer },
		});
		install_footer(ctx, DEFAULT_FOOTER_STATE);
		expect(set_footer).not.toHaveBeenCalled();
	});

	it('registers a footer renderer and branch-change invalidation', () => {
		const request_render = vi.fn();
		const dispose = vi.fn();
		const footer_data = make_footer_data({
			onBranchChange: vi.fn(() => dispose),
		});
		const set_footer = vi.fn();
		const ctx = make_context({ ui: { setFooter: set_footer } });

		install_footer(ctx, DEFAULT_FOOTER_STATE);

		const factory = set_footer.mock.calls[0]?.[0];
		expect(factory).toBeTypeOf('function');
		if (typeof factory !== 'function')
			throw new Error('missing footer factory');
		const footer = factory(
			{ requestRender: request_render } as never,
			test_theme,
			footer_data,
		);
		expect(footer.render(100).length).toBeGreaterThan(0);
		footer.dispose?.();
		expect(dispose).toHaveBeenCalled();
	});
});
