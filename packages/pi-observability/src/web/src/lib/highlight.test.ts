import { describe, expect, it } from 'vite-plus/test';
import { highlight } from './highlight.js';

describe('highlight', () => {
	it('highlights JSON and bash with twinkleplop markup', () => {
		const json = highlight(
			'{"isError": true, "exitCode": 2}',
			'json',
		);
		expect(json).toContain('twinkleplop');
		expect(json).toContain('isError');
		expect(json).not.toContain('<script');
		expect(highlight('ls /does-not-exist', 'bash')).toContain(
			'class="tok ',
		);
	});

	it('escapes plain text and untrusted payload content', () => {
		const html = highlight('<img src=x onerror=alert(1)>', 'text');
		expect(html).toContain('&lt;img');
		expect(html).not.toContain('<img');
		expect(highlight('"<b>"', 'json')).not.toContain('<b>');
	});

	it('marks JSON keys as properties and leaves values as strings', () => {
		const html = highlight(
			JSON.stringify({ toolName: 'bash', keys: ['a:b'] }, null, 2),
			'json',
		);
		expect(html).toContain(
			'<span class="tok property">&quot;toolName&quot;</span>',
		);
		expect(html).toContain(
			'<span class="tok string">&quot;bash&quot;</span>',
		);
		expect(html).toContain(
			'<span class="tok string">&quot;a:b&quot;</span>',
		);
	});
});
