import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PackageJson {
	name: string;
	scripts?: Record<string, string>;
	dependencies?: Record<string, string>;
}

function read_package_json(path: string): PackageJson {
	return JSON.parse(readFileSync(path, 'utf-8')) as PackageJson;
}

const root_package = read_package_json('package.json');
const package_json_paths = readdirSync('packages')
	.map((dir) => join('packages', dir, 'package.json'))
	.filter(existsSync)
	.sort();
const workspace_packages = package_json_paths.map(read_package_json);

const SELF_TASKS = ['build:self', 'check:self'] as const;
const GRAPH_BACKED_TASKS = ['build', 'check'] as const;
const EXPLICIT_WORKSPACE_FILTER = /--filter\s+@spences10\//;

describe('workspace package scripts', () => {
	it('keeps root tasks graph-backed and self-task based', () => {
		expect(root_package.scripts?.build).toContain('run build:self');
		expect(root_package.scripts?.check).toContain('run build:self');
		expect(root_package.scripts?.check).toContain('run check:self');
		expect(root_package.scripts?.test).toContain('run build:self');
		expect(root_package.scripts?.test).toContain('run test:self');
	});

	it('gives every package graph-backed build and check wrappers', () => {
		for (const pkg of workspace_packages) {
			for (const task of SELF_TASKS) {
				expect(pkg.scripts?.[task], pkg.name).toBeTruthy();
			}
			for (const task of GRAPH_BACKED_TASKS) {
				expect(pkg.scripts?.[task], pkg.name).toContain(
					'$npm_package_name^...',
				);
				expect(pkg.scripts?.[task], pkg.name).toContain(
					`run ${task}:self`,
				);
			}
		}
	});

	it('does not hand-code sibling workspace package names into scripts', () => {
		for (const pkg of workspace_packages) {
			for (const [name, script] of Object.entries(
				pkg.scripts ?? {},
			)) {
				expect(
					EXPLICIT_WORKSPACE_FILTER.test(script),
					`${pkg.name} ${name}`,
				).toBe(false);
			}
		}
	});
});
