import { Transformer } from '@napi-rs/image';
import { Resvg } from '@resvg/resvg-js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	check_preview,
	generate_preview,
	render_preview_svg,
} from './generate-package-preview.ts';

function pixel_hash(png: Buffer): string {
	const image = new Transformer(png);
	const { width, height } = image.metadataSync();
	const pixels = image.rawPixelsSync();
	const count = width * height;
	const channels = pixels.length / count;
	assert.ok(channels === 3 || channels === 4);
	const rgba = Buffer.alloc(count * 4, 255);
	for (let pixel = 0; pixel < count; pixel++) {
		pixels.copy(
			rgba,
			pixel * 4,
			pixel * channels,
			(pixel + 1) * channels,
		);
	}
	// Compare hashes, not multi-megabyte buffers: failed buffer assertions
	// can exhaust memory while formatting their diff.
	return createHash('sha256').update(rgba).digest('hex');
}

void test('renders a padded logo, configurable frame and minimal footer without incidental session details', () => {
	const svg = render_preview_svg('0.3.6', {
		model: 'gpt-6.1-sol',
		project: 'my-pi',
		border: {
			enabled: true,
			color: '#ff00b4',
			gradient: null,
			width: 1.5,
			radius: 6,
		},
		footer: {
			enabled: true,
			separator: true,
			editor: false,
			color: '#ff00b4',
			rows: [{ left: '~/repos/{project}', right: '{model}' }],
		},
	});
	assert.match(svg, /width="1188" height="536"/);
	assert.match(svg, /data-preview-border="true"/);
	assert.match(svg, /stroke="#ff00b4" stroke-width="1.5"/);
	assert.match(svg, /aria-label="gpt-6.1-sol · my-pi"/);
	assert.match(svg, /aria-label="~\/repos\/my-pi +gpt-6.1-sol"/);
	assert.doesNotMatch(
		svg,
		/\$0\.000|0\.0%|272k|Extensions built in|prompt:terse|MCP 6\/6/,
	);
});

void test('the default footer includes Git status, context, usage and thinking level', () => {
	const svg = render_preview_svg('0.6.0');
	assert.match(svg, /width="1188" height="701"/);
	assert.match(
		svg,
		/aria-label="~\/repos\/my-pi \( main \+10 \?11\) +"/,
	);
	assert.match(
		svg,
		/aria-label="\$0\.000 \(sub\) 0\.0%\/500k +gpt-6\.1-sol · high"/,
	);
	assert.match(svg, /aria-label="codex-usage:cx 2d 10% +"/);
});

void test('rounded frames have transparent corners without a square background', () => {
	const png = new Resvg(render_preview_svg('0.6.0')).render().asPng();
	const image = new Transformer(png);
	const { width, height } = image.metadataSync();
	const pixels = image.rawPixelsSync();
	assert.equal(pixels.length, width * height * 4);
	for (const [x, y] of [
		[0, 0],
		[width - 1, 0],
		[0, height - 1],
		[width - 1, height - 1],
		[3, 3],
		[width - 4, height - 4],
	]) {
		assert.equal(
			pixels[(y * width + x) * 4 + 3],
			0,
			`alpha at ${x},${y}`,
		);
	}
	assert.equal(
		pixels[
			(Math.floor(height / 2) * width + Math.floor(width / 2)) * 4 + 3
		],
		255,
	);
});

void test('version changes update the image and invalidate the previous preview', (t) => {
	const dir = mkdtempSync(join(tmpdir(), 'my-pi-preview-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const output = join(dir, 'preview.png');

	generate_preview('0.6.0', output);
	const previous = readFileSync(output);
	assert.equal(check_preview('0.6.0', output), true);
	assert.equal(check_preview('0.6.1', output), false);

	generate_preview('0.6.1', output);
	assert.equal(check_preview('0.6.1', output), true);
	assert.equal(readFileSync(output).equals(previous), false);
	assert.match(render_preview_svg('0.6.1'), /My-Pi v0\.6\.1/);
});

void test('compression preserves pixels and reduces the rendered PNG size', (t) => {
	const dir = mkdtempSync(join(tmpdir(), 'my-pi-preview-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const output = join(dir, 'preview.png');
	const original = new Resvg(render_preview_svg('0.6.0'))
		.render()
		.asPng();

	generate_preview('0.6.0', output);
	const optimized = readFileSync(output);
	assert.ok(optimized.length < original.length);
	assert.equal(pixel_hash(optimized), pixel_hash(original));
});

void test('freshness rejects missing, corrupt, and mismatched artifacts', (t) => {
	const dir = mkdtempSync(join(tmpdir(), 'my-pi-preview-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const output = join(dir, 'preview.png');
	assert.equal(check_preview('0.6.0', output), false);

	generate_preview('0.6.0', output);
	const metadata = readFileSync(`${output}.json`, 'utf8');
	const parsed = JSON.parse(metadata);
	assert.equal(metadata, `${JSON.stringify(parsed, null, '\t')}\n`);
	writeFileSync(
		`${output}.json`,
		JSON.stringify({ ...parsed, source_sha256: 'stale' }),
	);
	assert.equal(check_preview('0.6.0', output), false);

	writeFileSync(`${output}.json`, metadata);
	writeFileSync(output, 'not a PNG');
	assert.equal(check_preview('0.6.0', output), false);

	writeFileSync(`${output}.json`, '{');
	assert.equal(check_preview('0.6.0', output), false);
});

void test('release and validation scripts retain preview generation and checks', () => {
	const { scripts } = JSON.parse(
		readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
	);
	assert.equal(
		scripts.version,
		'changeset version && pnpm run preview:generate',
	);
	assert.match(scripts.check, /pnpm run preview:check/);
	assert.match(scripts.build, /pnpm run preview:check/);
	assert.match(scripts.test, /pnpm run test:preview/);
});

void test('the committed preview matches the launcher version', () => {
	const { version } = JSON.parse(
		readFileSync(
			new URL('../packages/my-pi/package.json', import.meta.url),
			'utf8',
		),
	);
	assert.equal(
		check_preview(
			version,
			fileURLToPath(
				new URL('../assets/pi-package-preview.png', import.meta.url),
			),
		),
		true,
	);
});
