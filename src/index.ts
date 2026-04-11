#!/usr/bin/env node

import { defineCommand, renderUsage, runMain } from 'citty';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
	readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'),
);

const main = defineCommand({
	meta: {
		name: 'my-pi',
		version: pkg.version,
		description:
			'Personal pi coding agent with MCP tool integration',
	},
	subCommands: {},
});

const arg = process.argv[2];
if (!arg && !process.stdout.isTTY) {
	const base = await renderUsage(main);
	console.log(base + '\n');
} else {
	void runMain(main);
}
