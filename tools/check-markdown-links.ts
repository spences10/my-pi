#!/usr/bin/env node
/// <reference types="node" />

import {
	existsSync,
	globSync,
	readFileSync,
	realpathSync,
	statSync,
} from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';

const files = [
	'README.md',
	...globSync('docs/**/*.md'),
	...globSync('packages/*/*.md'),
].sort();
const failures: string[] = [];
const markdown_link = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function heading_anchors(file: string): Set<string> {
	const anchors = new Set<string>();
	const counts = new Map<string, number>();
	for (const line of readFileSync(file, 'utf8').split('\n')) {
		const match = line.match(/^#{1,6}\s+(.+?)\s*#*$/);
		if (!match) continue;
		const base = (match[1] ?? '')
			.toLowerCase()
			.replace(/<[^>]+>/g, '')
			.replace(/[^\p{L}\p{N}\s_-]/gu, '')
			.trim()
			.replace(/\s+/g, '-');
		const count = counts.get(base) ?? 0;
		counts.set(base, count + 1);
		anchors.add(count === 0 ? base : `${base}-${count}`);
	}
	return anchors;
}

for (const file of files) {
	const source = readFileSync(file, 'utf8');
	for (const match of source.matchAll(markdown_link)) {
		const raw_target = match[1] ?? '';
		if (raw_target.startsWith('#')) {
			if (
				!heading_anchors(file).has(
					decodeURIComponent(raw_target.slice(1)),
				)
			)
				failures.push(
					`${file}: missing Markdown anchor ${raw_target}`,
				);
			continue;
		}
		if (/^(?:https?:|mailto:|npm:)/.test(raw_target)) continue;
		const [raw_path, raw_fragment] = raw_target.split('#', 2);
		const relative_path = decodeURIComponent(raw_path ?? '');
		if (!relative_path || relative_path.startsWith('/')) {
			failures.push(`${file}: invalid local link ${raw_target}`);
			continue;
		}
		const target = resolve(dirname(file), relative_path);
		if (!existsSync(target)) {
			failures.push(
				`${file}: missing local link target ${raw_target}`,
			);
			continue;
		}
		if (file.startsWith(`packages${sep}`)) {
			const package_root = realpathSync(dirname(file));
			const real_target = realpathSync(target);
			if (
				real_target !== package_root &&
				!real_target.startsWith(`${package_root}${sep}`)
			)
				failures.push(
					`${file}: package README link escapes its published package; use an absolute repository URL for ${raw_target}`,
				);
		}
		if (
			raw_fragment &&
			statSync(target).isFile() &&
			extname(target) === '.md' &&
			!heading_anchors(target).has(decodeURIComponent(raw_fragment))
		)
			failures.push(`${file}: missing Markdown anchor ${raw_target}`);
	}
}

if (failures.length > 0) {
	console.error('Markdown link validation failed:');
	for (const failure of failures) console.error(`- ${failure}`);
	process.exit(1);
}

console.log(`Checked local Markdown links in ${files.length} files.`);
