import { describe, expect, it } from 'vite-plus/test';
import { extensions } from './extensions.js';

describe('extensions', () => {
	it('loads each default extension once', () => {
		const names = extensions.map((extension) =>
			typeof extension === 'function' ? '' : extension.name,
		);
		expect(names).toEqual([
			'redact',
			'confirm-destructive',
			'context',
			'lsp',
		]);
		for (const extension of extensions) {
			expect(
				typeof extension === 'function'
					? extension
					: extension.factory,
			).toBeTypeOf('function');
		}
	});
});
