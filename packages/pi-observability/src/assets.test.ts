import { describe, expect, it } from 'vite-plus/test';
import {
	content_type,
	read_dashboard_asset,
	render_dashboard,
} from './assets.js';

describe('dashboard assets', () => {
	it('renders the dashboard shell without leaking template placeholders', () => {
		const html = render_dashboard('/tmp/<unsafe>&db.sqlite');

		expect(html).toContain('<!doctype html>');
		expect(html).toContain('<div id="app"></div>');
		expect(html).not.toContain('__DB_PATH__');
		expect(html).not.toContain('__BUILD__');
	});

	it('serves only built dashboard asset paths', () => {
		expect(
			read_dashboard_asset('/not-assets/app.js'),
		).toBeUndefined();
		expect(
			read_dashboard_asset('/assets/missing.js'),
		).toBeUndefined();
	});

	it('maps known content types and leaves unknown as binary', () => {
		expect(content_type('/assets/app.css')).toBe(
			'text/css; charset=utf-8',
		);
		expect(content_type('/assets/app.js')).toBe(
			'text/javascript; charset=utf-8',
		);
		expect(content_type('/assets/icon.svg')).toBe('image/svg+xml');
		expect(content_type('/assets/mona-sans.woff2')).toBe(
			'font/woff2',
		);
		expect(content_type('/assets/data.bin')).toBe(
			'application/octet-stream',
		);
	});
});
