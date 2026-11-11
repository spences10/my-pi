import { describe, it } from 'node:test';
import { RuleTester } from 'vite-plus/lint/plugins-dev';
import { no_nested_ternary } from './lint-rules.ts';

RuleTester.describe = describe;

RuleTester.it = it;

const tester = new RuleTester({
	languageOptions: { parserOptions: { lang: 'ts' } },
});

tester.run('my-pi/no-nested-ternary', no_nested_ternary, {
	valid: [
		'const a = b ? 1 : 2;',
		'const a = b ? 1 : 2; const c = d ? 3 : 4;',
		'const a = { b: c ? 1 : 2, d: e ? 3 : 4 };',
		'const a = [b ? 1 : 2, c ? 3 : 4];',
		'const a = f(b ? 1 : 2, c ? 3 : 4);',
		'const a = `${b ? "x" : "y"}`;',
		'const a = b ? () => c ? 1 : 2 : null;',
		'const a = b ? f(() => c ? 1 : 2) : null;',
		'const a = b ? function () { return c ? 1 : 2; } : null;',
		'const a = b ? { value() { return c ? 1 : 2; } } : null;',
		'const a = b ? { get value() { return c ? 1 : 2; } } : null;',
	],
	invalid: [
		...[
			'const a = b ? 1 : c ? 2 : 3;',
			'const a = b ? (c ? 1 : 2) : 3;',
			'const a = (b ? c : d) ? 1 : 2;',
			'const a = b ? 1 : c ? 2 : d ? 3 : 4;',
			'const a = b ? { value: c ? 1 : 2 } : null;',
			'const a = b ? [c ? 1 : 2] : [];',
			'const a = b ? f(c ? 1 : 2) : 3;',
			'const a = f(b ? 1 : 2) ? 3 : 4;',
			'const a = b ? `${c ? "x" : "y"}` : "z";',
			'const a = b ? (c && (d ? 1 : 2)) : 3;',
			'const a = b ? ((c ? 1 : 2) as number) : 3;',
			'const a = b ? ({ x: c ? 1 : 2 } satisfies Data) : null;',
			'const a = b ? (c ? 1 : 2)! : 3;',
			'const a = b ? { [c ? "x" : "y"]: 1 } : null;',
		].map((code) => ({
			code,
			errors: [{ messageId: 'nested', line: 1 }],
		})),
		{
			name: 'reports the outer expression once for several nested fields',
			code: `summary[key] =
	value === null
		? null
		: {
			tokens: typeof usage.tokens === 'number' ? usage.tokens : null,
			contextWindow: typeof usage.contextWindow === 'number' ? usage.contextWindow : null,
			percent: typeof usage.percent === 'number' ? usage.percent : null,
		};`,
			errors: [{ messageId: 'nested', line: 2 }],
		},
		{
			name: 'still checks nested branching inside a callback',
			code: `const a = b ? () => {
	return c ? f(d ? 1 : 2) : 3;
} : null;`,
			errors: [{ messageId: 'nested', line: 2 }],
		},
		{
			name: 'reports separate offending expressions separately',
			code: 'const a = [b ? f(c ? 1 : 2) : 3, d ? [e ? 4 : 5] : []];',
			errors: [{ messageId: 'nested' }, { messageId: 'nested' }],
		},
		{
			name: 'checks outer and callback expressions independently',
			code: 'const a = b ? { x: c ? 1 : 2, y: () => d ? f(e ? 3 : 4) : 5 } : null;',
			errors: [{ messageId: 'nested' }, { messageId: 'nested' }],
		},
	],
});
