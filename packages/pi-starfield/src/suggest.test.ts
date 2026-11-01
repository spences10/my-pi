import { describe, expect, it } from 'vite-plus/test';
import { clean_suggestion, suggestion_context } from './suggest.js';

describe('suggestion_context', () => {
	it('uses the last user prompt and final agent reply', () => {
		const context = suggestion_context([
			{ role: 'user', content: 'old prompt' },
			{
				role: 'user',
				content: [{ type: 'text', text: 'fix the bug' }],
			},
			{
				role: 'assistant',
				content: [{ type: 'text', text: 'Fixed.' }],
			},
			{ role: 'toolResult', content: [] },
		]);
		const content = context?.messages[0]?.content;
		expect(content).toContain('fix the bug');
		expect(content).toContain('Fixed.');
		expect(content).not.toContain('old prompt');
	});

	it('returns undefined without both a prompt and a reply', () => {
		expect(suggestion_context([])).toBeUndefined();
		expect(
			suggestion_context([{ role: 'user', content: 'hi' }]),
		).toBeUndefined();
	});
});

describe('clean_suggestion', () => {
	it('keeps the first line without quotes', () => {
		expect(clean_suggestion('"run the tests"\nextra')).toBe(
			'run the tests',
		);
		expect(clean_suggestion('  \n')).toBeUndefined();
	});
});
