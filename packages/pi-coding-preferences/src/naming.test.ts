import { describe, expect, it } from 'vite-plus/test';
import { assert_naming, resolve_naming_config } from './naming.js';

const config = {
	variables: 'snake_case',
	functions: 'snake_case',
	types: 'PascalCase',
} as const;

function check(
	content: string,
	path = 'example.ts',
	previous?: string,
) {
	assert_naming(path, content, previous, config);
}

describe('syntax-aware naming', () => {
	it.each([
		'const badName = 1;',
		'let badName = 1;',
		'function badName() {}',
		'const badName = () => {};',
		'const badName = function () {};',
		'const good_name = function badName() {};',
		'function good_name(badName: number) {}',
		'const good_name = (badName: number) => badName;',
		'const [badName] = [1];',
		'const { externalName: badName } = source;',
		'try {} catch (badName) {}',
		'for (const badName of []) {}',
		'class bad_name {}',
		'interface bad_name {}',
		'type bad_name = string;',
		'enum bad_name { ExternalValue }',
	])('rejects actual declarations: %s', (content) => {
		expect(() => check(content)).toThrow(
			/must use (snake_case|PascalCase)/,
		);
	});

	it.each([
		'const good_name = 1;',
		'const $good_name = 1; let _private_name = 2;',
		'function good_name(good_parameter: number) {}',
		'class GoodName { externalMethod(external_parameter: number) {} externalProperty = 1; }',
		'const GoodName = class {};',
		'class GoodName { constructor(public externalProperty: string) {} }',
		'interface GoodName { externalProperty: string; externalMethod(): void; }',
		'type GoodName = { externalProperty: string };',
		'enum GoodName { ExternalValue }',
		'const good_name = { externalProperty: 1, externalMethod() {} };',
		'import { externalName, anotherName as localName } from "external";',
		'import ExternalName from "external"; import * as externalNamespace from "external";',
		'const { externalName, otherName: local_name } = source;',
		'const good_name = "const badName = 1; type bad_name = string";',
		'// const badName = 1;\n/* function badName() {} */',
		'throw new Error("--type must be user, assistant, toolResult, or all");',
		'test("type combines with project and session", () => {});',
	])(
		'leaves valid names, prose, and API-shaped names alone: %s',
		(content) => {
			expect(() => check(content)).not.toThrow();
		},
	);

	it.each([
		'ts',
		'tsx',
		'mts',
		'cts',
		'js',
		'jsx',
		'mjs',
		'cjs',
		'svelte.ts',
		'svelte.js',
	])('checks %s files without project configuration', (extension) => {
		expect(() =>
			check('const badName = 1;', `file.${extension}`),
		).toThrow('naming.variables');
	});

	it('parses JSX and TSX rather than matching markup', () => {
		check(
			'const good_name = <ExternalComponent externalProp="badName" />;',
			'example.tsx',
		);
		expect(() =>
			check('const badName = <div />;', 'example.jsx'),
		).toThrow('badName');
	});

	it('checks both Svelte scripts, not markup or styles', () => {
		check(
			'<script lang="ts">import ExternalComponent from "external"; let good_name = $state(0);</script><ExternalComponent externalProp={good_name} /><style>.badName { color: red; }</style>',
			'Example.svelte',
		);
		check(
			'<p>const badName = 1;</p><!-- function badName() {} -->',
			'Example.svelte',
		);

		for (const context of ['', ' module']) {
			expect(() =>
				check(
					`<script${context} lang="ts">const badName = 1;</script>`,
					'Example.svelte',
				),
			).toThrow('badName');
		}
	});

	it('reports file, line, column, declaration, and rule', () => {
		expect(() =>
			check(
				'<script lang="ts">\nconst badName = 1;\n</script>',
				'Example.svelte',
			),
		).toThrow(
			'Example.svelte:2:7: variables declaration "badName" must use snake_case',
		);
	});

	it('allows unchanged legacy violations and corrective edits', () => {
		const previous = 'const legacyName = 1;\nconst oldName = 2;';
		check(
			'const legacyName = 1;\nconst old_name = 2;',
			'example.ts',
			previous,
		);
		check(
			'const legacyName = 2;\nconst old_name = 2;',
			'example.ts',
			previous,
		);
		expect(() =>
			check(
				previous + '\nfunction newName() {}',
				'example.ts',
				previous,
			),
		).toThrow('newName');
		expect(() =>
			check(
				'const legacyName = 1; function good_name() { const legacyName = 2; }',
				'example.ts',
				previous,
			),
		).toThrow('legacyName');
	});

	it('rejects invalid proposed syntax but allows repairing invalid originals', () => {
		expect(() => check('const good_name = ;')).toThrow(
			'Cannot validate naming',
		);
		expect(() =>
			check('<script>const good_name = ;</script>', 'Example.svelte'),
		).toThrow();
		check('const good_name = 1;', 'example.ts', 'const badName = ;');
	});

	it('ignores unsupported languages', () => {
		check('const badName = ;', 'notes.md');
		check('{ "badName": 1 }', 'data.json');
	});

	it('supports configurable styles and per-category disabling', () => {
		const custom = resolve_naming_config({
			variables: 'camelCase',
			functions: false,
			types: false,
		});

		if (custom === false) throw new Error('Missing custom policy');
		assert_naming(
			'example.ts',
			'const goodName = 1; function Any_NAME() {} type any_name = string;',
			undefined,
			custom,
		);
		expect(() =>
			assert_naming(
				'example.ts',
				'const bad_name = 1;',
				undefined,
				custom,
			),
		).toThrow('camelCase');
		expect(resolve_naming_config(undefined)).toEqual(config);
		expect(resolve_naming_config(false)).toBe(false);
		expect(() => resolve_naming_config(JSON.parse('[]'))).toThrow(
			'must be an object or false',
		);

		const function_policy = resolve_naming_config({
			functions: 'PascalCase',
		});

		if (function_policy === false)
			throw new Error('Missing function policy');
		assert_naming(
			'example.ts',
			'const GoodName = () => {}; const good_name = 1;',
			undefined,
			function_policy,
		);
		expect(() =>
			assert_naming(
				'example.ts',
				'const bad_name = () => {};',
				undefined,
				function_policy,
			),
		).toThrow('naming.functions');
		expect(() =>
			resolve_naming_config(JSON.parse('{"variables":"invalid"}')),
		).toThrow('Invalid codingPreferences.naming style');
	});
});
