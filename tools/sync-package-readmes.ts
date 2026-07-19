#!/usr/bin/env node
/// <reference types="node" />

import { globSync, readFileSync, writeFileSync } from 'node:fs';

const check_only = !process.argv.includes('--write');
const region_pattern =
	/<!-- package-readme:(header|install|development):start([^>]*) -->\n[\s\S]*?\n<!-- package-readme:\1:end -->/g;

function package_manifest(readme: string): {
	name: string;
	scripts?: Record<string, string>;
} {
	return JSON.parse(
		readFileSync(
			readme.replace(/README\.md$/, 'package.json'),
			'utf8',
		),
	) as { name: string; scripts?: Record<string, string> };
}

function header_block(name: string, attributes: string): string {
	const uses_vitest = !attributes.includes('vitest="false"');
	return [
		`<!-- package-readme:header:start${uses_vitest ? '' : ' vitest="false"'} -->`,
		'',
		`[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)`,
		...(uses_vitest
			? [
					`[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)`,
				]
			: []),
		`[![npm version](https://img.shields.io/npm/v/${name}?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/${name})`,
		`[![license](https://img.shields.io/npm/l/${name})](https://www.npmjs.com/package/${name})`,
		'',
		'![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)',
		'',
		'<!-- package-readme:header:end -->',
	].join('\n');
}

function install_block(name: string): string {
	return [
		'<!-- package-readme:install:start -->',
		'',
		'```bash',
		`pi install npm:${name}`,
		'```',
		'',
		'<!-- package-readme:install:end -->',
	].join('\n');
}

function development_block(
	name: string,
	commands_attribute: string | undefined,
	scripts: Record<string, string> | undefined,
	readme: string,
): string {
	const commands =
		commands_attribute?.split(',').filter(Boolean) ?? [];
	if (commands.length === 0)
		throw new Error(`${readme}: development region needs commands`);
	for (const command of commands) {
		if (!scripts?.[command])
			throw new Error(
				`${readme}: package.json has no ${command} script`,
			);
	}
	return [
		`<!-- package-readme:development:start commands="${commands.join(',')}" -->`,
		'',
		'Package scripts build transitive workspace dependencies first, then',
		'run local tools through Vite+ with `vp exec`.',
		'',
		'```bash',
		...commands.map(
			(command) => `pnpm --filter ${name} run ${command}`,
		),
		'```',
		'',
		'<!-- package-readme:development:end -->',
	].join('\n');
}

const changed: string[] = [];
let regions = 0;

for (const readme of globSync('packages/*/README.md').sort()) {
	const manifest = package_manifest(readme);
	const source = readFileSync(readme, 'utf8');
	const starts =
		source.match(/<!-- package-readme:[^:]+:start/g) ?? [];
	const ends =
		source.match(/<!-- package-readme:[^:]+:end -->/g) ?? [];
	if (starts.length !== ends.length)
		throw new Error(`${readme}: unmatched generated-region marker`);

	let matched = 0;
	const generated = source.replace(
		region_pattern,
		(_region, kind: string, attributes: string) => {
			matched += 1;
			regions += 1;
			if (kind === 'header')
				return header_block(manifest.name, attributes);
			if (kind === 'install') return install_block(manifest.name);
			const commands = attributes.match(/commands="([^"]+)"/)?.[1];
			return development_block(
				manifest.name,
				commands,
				manifest.scripts,
				readme,
			);
		},
	);
	if (matched !== starts.length)
		throw new Error(`${readme}: malformed generated-region marker`);
	if (generated === source) continue;
	changed.push(readme);
	if (!check_only) writeFileSync(readme, generated);
}

if (regions === 0) throw new Error('no package README regions found');
if (check_only && changed.length > 0) {
	console.error('Package README generated regions are stale:');
	for (const readme of changed) console.error(`- ${readme}`);
	console.error('Run pnpm docs:sync.');
	process.exit(1);
}

console.log(
	check_only
		? `Checked ${regions} generated package README regions.`
		: `Synchronized ${regions} generated package README regions.`,
);
