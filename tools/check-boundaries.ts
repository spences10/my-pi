#!/usr/bin/env node
/// <reference types="node" />

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

type Finding = { file: string; message: string; detail?: string };

const violations: Finding[] = [];
const advisories: Finding[] = [];

const support_packages = new Set([
	'@spences10/pi-child-env',
	'@spences10/pi-git-remote',
	'@spences10/pi-project-trust',
	'@spences10/pi-settings',
	'@spences10/pi-tui-modal',
]);

const lightweight_packages = new Set([
	'@spences10/pi-nopeek',
	'@spences10/pi-omnisearch',
	'@spences10/pi-recall',
	'@spences10/pi-sqlite-tools',
]);

function git_files(pattern: string): string[] {
	return execFileSync('git', ['ls-files', pattern], {
		encoding: 'utf8',
	})
		.split('\n')
		.filter(Boolean)
		.filter((file) => !file.includes('/dist/'));
}

function workspace_of(file: string): string | null {
	const match = file.match(/^(apps|packages)\/([^/]+)\//);
	return match ? `${match[1]}/${match[2]}` : null;
}

function package_name_from_workspace(
	workspace: string | null,
): string | null {
	if (!workspace?.startsWith('packages/')) return null;
	const package_json = `${workspace}/package.json`;
	try {
		const pkg = JSON.parse(readFileSync(package_json, 'utf8')) as {
			name?: string;
		};
		return pkg.name ?? null;
	} catch {
		return null;
	}
}

function report(file: string, message: string, detail?: string) {
	violations.push({ file, message, detail });
}

function advise(file: string, message: string, detail?: string) {
	advisories.push({ file, message, detail });
}

function import_specifiers(source: string): string[] {
	const specs: string[] = [];
	const patterns = [
		/import\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
		/export\s+(?:type\s+)?[^'";]+?\s+from\s+['"]([^'"]+)['"]/g,
		/import\(\s*['"]([^'"]+)['"]\s*\)/g,
	];
	for (const pattern of patterns) {
		for (const match of source.matchAll(pattern))
			specs.push(match[1] ?? '');
	}
	return specs.filter(Boolean);
}

function check_import(file: string, specifier: string) {
	const source_workspace = workspace_of(file);
	const source_package =
		package_name_from_workspace(source_workspace);

	if (/^@spences10\/pi-[^/]+\/src\//.test(specifier)) {
		report(
			file,
			'use the package public entrypoint instead of a deep @spences10 import',
			specifier,
		);
	}

	if (/^@spences10\/pi-[^/]+\/dist(?:\/|$)/.test(specifier)) {
		report(
			file,
			'do not import another package dist output',
			specifier,
		);
	}

	if (
		specifier.startsWith('packages/') ||
		specifier.includes('/packages/')
	) {
		report(
			file,
			'do not import packages by repository path; use package entrypoints',
			specifier,
		);
	}

	if (
		specifier.startsWith('src/') &&
		source_workspace?.startsWith('packages/')
	) {
		report(
			file,
			'packages must not import from root src files',
			specifier,
		);
	}

	if (
		source_workspace?.startsWith('packages/') &&
		specifier.startsWith('@spences10/')
	) {
		if (
			support_packages.has(source_package ?? '') &&
			!support_packages.has(specifier)
		) {
			report(
				file,
				'support packages must not depend on feature packages',
				specifier,
			);
		}
		if (
			lightweight_packages.has(source_package ?? '') &&
			!support_packages.has(specifier)
		) {
			report(
				file,
				'lightweight reminder packages must not depend on feature packages',
				specifier,
			);
		}
	}

	if (!specifier.startsWith('.')) return;

	const target = new URL(
		specifier,
		`file://${process.cwd()}/${file}`,
	).pathname
		.slice(process.cwd().length + 1)
		.replace(/\/[^/]*$/, '');
	const target_workspace = workspace_of(target);
	if (
		!source_workspace ||
		!target_workspace ||
		source_workspace === target_workspace
	)
		return;

	if (
		source_workspace.startsWith('packages/') &&
		target_workspace.startsWith('apps/')
	) {
		report(file, 'packages must not import from apps', specifier);
	}
	if (
		source_workspace.startsWith('packages/') &&
		target_workspace === null
	) {
		report(
			file,
			'packages must not import from root source files',
			specifier,
		);
	}
	if (
		source_workspace.startsWith('apps/') &&
		target_workspace.startsWith('apps/')
	) {
		report(
			file,
			'apps must not import other apps directly',
			specifier,
		);
	}
}

function should_check_file_size(file: string): boolean {
	if (file.endsWith('.test.ts') || file.endsWith('.spec.ts'))
		return false;
	if (file.endsWith('.d.ts')) return false;
	if (file.includes('/.svelte-kit/')) return false;
	return true;
}

function check_file_size(file: string, source: string) {
	if (!should_check_file_size(file)) return;
	const lines = source.split('\n').length;
	if (lines > 600) {
		advise(
			file,
			`large source file (${lines} lines); consider splitting when you next touch it`,
		);
	}
}

function check_source_file(file: string) {
	const source = readFileSync(file, 'utf8');
	for (const specifier of import_specifiers(source))
		check_import(file, specifier);
	check_file_size(file, source);
}

function print_findings(label: string, findings: Finding[]) {
	console.error(`${label}:`);
	for (const finding of findings) {
		const detail = finding.detail ? ` (${finding.detail})` : '';
		console.error(`- ${finding.file}: ${finding.message}${detail}`);
	}
}

function run() {
	const files = git_files('*.ts').concat(git_files('*.svelte'));
	for (const file of files) check_source_file(file);

	if (advisories.length)
		print_findings('Architecture advisories', advisories);
	if (violations.length) {
		print_findings('Boundary check failed', violations);
		process.exit(1);
	}

	console.log(
		`Boundary check passed (${files.length} files scanned, ${advisories.length} advisories).`,
	);
}

run();
