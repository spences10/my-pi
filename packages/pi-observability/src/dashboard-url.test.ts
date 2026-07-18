import { describe, expect, it } from 'vitest';
import { authenticated_dashboard_url } from './dashboard-url.js';

describe('authenticated_dashboard_url', () => {
	it('puts credentials in the fragment instead of the query string', () => {
		const url = authenticated_dashboard_url(
			'http://127.0.0.1:43190/',
			'local value',
		);
		const parsed = new URL(url);

		expect(parsed.search).toBe('');
		expect(parsed.hash).toBe('#token=local+value');
	});

	it('leaves unauthenticated custom dashboards unchanged', () => {
		expect(
			authenticated_dashboard_url(
				'https://observability.example/',
				undefined,
			),
		).toBe('https://observability.example/');
	});
});
