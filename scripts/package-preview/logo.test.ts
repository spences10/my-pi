import { logo_lines } from 'my-pi/logo';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

void test('the published logo entrypoint works without a CLI build', (t) => {
	const dir = mkdtempSync(join(tmpdir(), 'my-pi-logo-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const source = fileURLToPath(
		new URL('../../packages/my-pi/', import.meta.url),
	);
	const target = join(dir, 'node_modules', 'my-pi');
	mkdirSync(target, { recursive: true });
	const manifest = JSON.parse(
		readFileSync(join(source, 'package.json'), 'utf8'),
	) as { files: string[] };
	for (const file of ['logo.js', 'logo.d.ts']) {
		assert.ok(manifest.files.includes(file));
		copyFileSync(join(source, file), join(target, file));
	}
	copyFileSync(
		join(source, 'package.json'),
		join(target, 'package.json'),
	);
	const result = spawnSync(
		process.execPath,
		[
			'--input-type=module',
			'--eval',
			`import { logo_lines } from 'my-pi/logo';
			 console.log(JSON.stringify(logo_lines));`,
		],
		{ cwd: dir, encoding: 'utf8' },
	);
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(JSON.parse(result.stdout), logo_lines);
	assert.equal(Object.isFrozen(logo_lines), true);
});
