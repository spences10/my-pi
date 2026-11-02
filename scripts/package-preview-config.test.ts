import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	check_preview,
	generate_preview,
	render_preview_svg,
} from './generate-package-preview.ts';
import { preview_options } from './package-preview-cli.ts';
import {
	load_preview_config,
	parse_preview_config,
} from './package-preview-config.ts';

const fixture = parse_preview_config({
	model: 'gpt-6.1-sol',
	project: 'my-pi',
	border: { enabled: true, color: '#ff00b4', width: 1.5, radius: 6 },
	footer: {
		enabled: true,
		separator: true,
		color: '#ff00b4',
		rows: [{ left: '~/repos/{project}', right: '{model}' }],
	},
});

const generator_path = fileURLToPath(
	new URL('./generate-package-preview.ts', import.meta.url),
);

function cli(args: string[]) {
	const result = spawnSync(
		process.execPath,
		[generator_path, ...args],
		{
			encoding: 'utf8',
			maxBuffer: 65536,
			timeout: 15000,
			env: { ...process.env, RAYON_NUM_THREADS: '2' },
		},
	);
	assert.ifError(result.error);
	return result;
}

void test('JSON overrides inherit defaults and CLI flags win per nested field', (t) => {
	const dir = mkdtempSync(join(tmpdir(), 'my-pi-config-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, 'preview.json');
	writeFileSync(
		path,
		JSON.stringify({
			model: 'json-model',
			border: { color: '#123456', radius: 12 },
			footer: {
				color: '#abc',
				rows: [
					{ left: 'file-left', right: '{model}' },
					{ left: 'second-row' },
				],
			},
		}),
	);
	const options = preview_options([
		'--config',
		path,
		'--model',
		'cli-model',
		'--no-border',
		'--border-width',
		'2',
		'--footer-left',
		'cli-left',
		'--no-footer-separator',
		'--output',
		join(dir, 'custom.png'),
	]);
	assert.ok(!options.help);
	assert.equal(options.config.project, load_preview_config().project);
	assert.equal(options.config.model, 'cli-model');
	assert.deepEqual(options.config.border, {
		enabled: false,
		color: '#123456',
		gradient: null,
		radius: 12,
		width: 2,
	});
	assert.equal(options.config.footer.color, '#abc');
	assert.equal(options.config.footer.separator, false);
	assert.deepEqual(options.config.footer.rows, [
		{ left: 'cli-left', right: '{model}' },
		{ left: 'second-row', right: '' },
	]);
	assert.equal(options.output_path, resolve(dir, 'custom.png'));
});

void test('booleans, empty footer overrides and pnpm argument separators work', () => {
	const options = preview_options([
		'--',
		'--border',
		'--no-footer',
		'--footer-left',
		'',
		'--footer-right',
		'',
	]);
	assert.ok(!options.help);
	assert.equal(options.config.border.enabled, true);
	assert.equal(options.config.footer.enabled, false);
	assert.deepEqual(options.config.footer.rows, [
		{ left: '', right: '' },
		...load_preview_config().footer.rows.slice(1),
	]);
});

void test('unknown fields, invalid nested values and oversized inputs fail explicitly', () => {
	const base = load_preview_config();
	for (const invalid of [
		null,
		[],
		{ version: '9.9.9' },
		{ border: null },
		{ border: { colour: '#fff' } },
		{ border: { color: 'red' } },
		{ border: { color: 'url(https://example.com)' } },
		{ border: { enabled: 'true' } },
		{ border: { width: 0 } },
		{ border: { width: Infinity } },
		{ border: { gradient: [] } },
		{ border: { gradient: ['#fff'] } },
		{ border: { gradient: ['#fff', 'invalid'] } },
		{ border: { gradient: Array.from({ length: 9 }, () => '#fff') } },
		{ footer: { editor: 'true' } },
		{ border: { radius: 33 } },
		{ footer: { separator: 1 } },
		{ footer: { rows: null } },
		{ footer: { rows: Array.from({ length: 7 }, () => ({})) } },
		{ footer: { rows: [{ left: 12 }] } },
		{ footer: { rows: [{ center: 'unknown' }] } },
		{ model: 'x'.repeat(241) },
		{ project: 'two\nlines' },
		{ project: 'two\u2028lines' },
		{ project: '\u001b[31mcontrol' },
	]) {
		assert.throws(() => parse_preview_config(invalid, base));
	}
	assert.throws(
		() => preview_options(['--border-width', 'nope']),
		/must be a number/,
	);
	assert.throws(
		() => preview_options(['--border-radius', '']),
		/must be a number/,
	);
	assert.throws(() => preview_options(['--unknown-option']));
	assert.throws(() => preview_options(['positional']));
	assert.throws(() => preview_options(['--version', '9.9.9']));
});

void test('missing and malformed JSON fail without echoing file contents', (t) => {
	const dir = mkdtempSync(join(tmpdir(), 'my-pi-config-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, 'bad.json');
	assert.throws(
		() => load_preview_config(path),
		/Cannot read preview config/,
	);
	writeFileSync(path, 'PRIVATE_SENTINEL not json');
	assert.throws(
		() => load_preview_config(path),
		(error: unknown) => {
			assert.ok(error instanceof Error);
			assert.match(error.message, /valid JSON/);
			assert.doesNotMatch(error.message, /PRIVATE_SENTINEL/);
			return true;
		},
	);
});

void test('rounded gradient borders and the editor area match the reference layout', () => {
	const config = parse_preview_config(
		{
			border: { radius: 18, gradient: ['#9d4dff', '#00eaff'] },
			footer: {
				editor: true,
				rows: [{ left: '~/repos/{project}' }, { right: '{model}' }],
			},
		},
		fixture,
	);
	const svg = render_preview_svg('1.2.3', config);
	assert.match(svg, /width="1188" height="668"/);
	assert.match(svg, /rx="18"/);
	assert.match(svg, /stroke="url\(#preview-frame\)"/);
	assert.match(svg, /stop-color="#9d4dff"/);
	assert.match(svg, /stop-color="#00eaff"/);
	assert.match(svg, /fill="#fff7ff"/);
	const compact = render_preview_svg(
		'1.2.3',
		parse_preview_config({ footer: { editor: false } }, config),
	);
	assert.doesNotMatch(compact, /fill="#fff7ff"/);
	assert.match(compact, /height="569"/);
});

void test('gradient, rounding and editor CLI overrides work without changing solid-colour overrides', () => {
	const options = preview_options([
		'--border-gradient',
		'#123, #abc',
		'--border-radius',
		'18',
		'--footer-editor',
	]);
	assert.ok(!options.help);
	assert.deepEqual(options.config.border.gradient, ['#123', '#abc']);
	assert.equal(options.config.border.radius, 18);
	assert.equal(options.config.footer.editor, true);
	const solid = preview_options([
		'--border-color',
		'#fff',
		'--no-footer-editor',
	]);
	assert.ok(!solid.help);
	assert.equal(solid.config.border.gradient, null);
	assert.equal(solid.config.footer.editor, false);
	assert.equal(
		parse_preview_config(
			{ border: { color: '#fff' } },
			options.config,
		).border.gradient,
		null,
	);
});

void test('border and footer can be hidden independently and empty row lists collapse', () => {
	const base = fixture;
	const no_border = render_preview_svg(
		'1.2.3',
		parse_preview_config({ border: { enabled: false } }, base),
	);
	assert.doesNotMatch(no_border, /data-preview-border/);
	assert.match(no_border, /~\/repos\/my-pi/);
	for (const footer of [{ enabled: false }, { rows: [] }]) {
		const svg = render_preview_svg(
			'1.2.3',
			parse_preview_config({ footer }, base),
		);
		assert.match(svg, /data-preview-border/);
		assert.match(svg, /height="470"/);
		assert.doesNotMatch(svg, /~\/repos\/my-pi/);
	}
});

void test('footer templates are literal data, XML is escaped, and Unicode rows stay inside the frame', () => {
	const config = parse_preview_config(
		{
			model: 'custom-model',
			project: 'demo<&"',
			border: { enabled: true, color: '#abc', width: 2, radius: 9 },
			footer: {
				enabled: true,
				separator: false,
				rows: [
					{ left: '{version} {project}', right: '{model}' },
					{
						left: '项目👩‍💻e\u0301'.repeat(25),
						right: '界'.repeat(100),
					},
					{
						left: '<script>not code</script>',
						right: '$(not-a-command)',
					},
				],
			},
		},
		load_preview_config(),
	);
	const svg = render_preview_svg('1.2.3', config);
	assert.match(svg, /stroke="#abc" stroke-width="2"/);
	assert.match(svg, /rx="9"/);
	assert.match(svg, /1\.2\.3 demo&lt;&amp;&quot;/);
	assert.match(svg, /custom-model/);
	assert.match(svg, /&lt;script&gt;not code&lt;\/script&gt;/);
	assert.match(svg, /\$\(not-a-command\)/);
	assert.doesNotMatch(svg, /<script>/);
	for (const [, x] of svg.matchAll(/<text x="([\d.]+)"/g)) {
		assert.ok(Number(x) >= 18 && Number(x) < 1458);
	}
});

void test('config changes participate in preview freshness', (t) => {
	const dir = mkdtempSync(join(tmpdir(), 'my-pi-config-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const output = join(dir, 'preview.png');
	const base = fixture;
	generate_preview('1.2.3', output, base);
	assert.equal(check_preview('1.2.3', output, base), true);
	for (const override of [
		{ border: { color: '#fff' } },
		{ footer: { rows: [{ left: 'changed' }] } },
		{ project: 'another-project' },
	]) {
		assert.equal(
			check_preview(
				'1.2.3',
				output,
				parse_preview_config(override, base),
			),
			false,
		);
	}
	const hidden = parse_preview_config(
		{ footer: { enabled: false } },
		base,
	);
	generate_preview('1.2.3', output, hidden);
	const changed_hidden = parse_preview_config(
		{ footer: { color: '#fff' } },
		hidden,
	);
	assert.equal(
		render_preview_svg('1.2.3', hidden) ===
			render_preview_svg('1.2.3', changed_hidden),
		true,
	);
	assert.equal(check_preview('1.2.3', output, changed_hidden), false);
});

void test('the real CLI creates custom output, checks read-only, and uses the package version', (t) => {
	const dir = mkdtempSync(join(tmpdir(), 'my-pi-cli-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const output = join(dir, 'nested', 'preview.png');
	const args = [
		'--output',
		output,
		'--model',
		'cli-model',
		'--project',
		'cli-project',
		'--no-border',
		'--footer',
		'--footer-right',
		'{version}',
	];
	const generated = cli(args);
	assert.equal(generated.status, 0, generated.stderr);
	const image = readFileSync(output);
	const metadata = readFileSync(`${output}.json`, 'utf8');
	const { version } = JSON.parse(
		readFileSync(
			new URL('../packages/my-pi/package.json', import.meta.url),
			'utf8',
		),
	);
	assert.equal(JSON.parse(metadata).version, version);
	const checked = cli([...args, '--check']);
	assert.equal(checked.status, 0, checked.stderr);
	assert.equal(readFileSync(output).equals(image), true);
	assert.equal(readFileSync(`${output}.json`, 'utf8'), metadata);
	const stale = cli([...args, '--no-footer', '--check']);
	assert.equal(stale.status, 1);
	assert.match(stale.stderr, /stale/);
	assert.equal(readFileSync(output).equals(image), true);
});

void test('CLI help and invalid options never write output', (t) => {
	const dir = mkdtempSync(join(tmpdir(), 'my-pi-cli-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const output = join(dir, 'preview.png');
	const help = cli(['--help', '--output', output]);
	assert.equal(help.status, 0, help.stderr);
	assert.match(help.stdout, /Precedence:/);
	for (const flags of [
		['--border-color', 'red'],
		['--footer-colour', '#fff'],
	]) {
		const invalid = cli(['--output', output, ...flags]);
		assert.equal(invalid.status, 1);
	}
	assert.equal(existsSync(output), false);
	assert.equal(existsSync(`${output}.json`), false);
});
