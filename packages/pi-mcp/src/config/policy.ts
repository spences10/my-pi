import { read_settings } from '@spences10/pi-settings';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import {
	global_mcp_policy_path,
	project_mcp_policy_path,
} from './paths.js';
import type { RawMcpPolicyEntry, RawMcpPolicyFile } from './types.js';

function read_policy_file(path: string): RawMcpPolicyFile {
	if (path === global_mcp_policy_path()) {
		const parsed = (read_settings().mcp?.policy ??
			{}) as RawMcpPolicyFile;
		return { servers: parsed.servers ?? {} };
	}
	if (!existsSync(path)) return { servers: {} };
	const parsed = JSON.parse(
		readFileSync(path, 'utf-8'),
	) as RawMcpPolicyFile;
	return { servers: parsed.servers ?? {} };
}

function as_string_array(
	value: unknown,
	label: string,
): string[] | undefined {
	if (value === undefined) return undefined;
	const values = typeof value === 'string' ? [value] : value;
	if (
		!Array.isArray(values) ||
		values.some((entry) => typeof entry !== 'string' || !entry.trim())
	) {
		throw new Error(
			`Invalid MCP policy: ${label} must be a string or string array`,
		);
	}
	return values.map((entry) => entry.trim());
}

function parse_github_repo(remote: string): string | undefined {
	const trimmed = remote.trim().replace(/\.git$/, '');
	const match =
		/^git@github\.com:([^/]+)\/(.+)$/.exec(trimmed) ??
		/^https:\/\/github\.com\/([^/]+)\/(.+)$/.exec(trimmed) ??
		/^ssh:\/\/git@github\.com\/([^/]+)\/(.+)$/.exec(trimmed);
	if (!match) return undefined;
	return `${match[1]}/${match[2]}`.toLowerCase();
}

export function get_github_repos(cwd: string): string[] {
	try {
		const output = execFileSync('git', ['remote', '-v'], {
			cwd,
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});
		return [
			...new Set(
				output
					.split('\n')
					.map((line) => line.trim().split(/\s+/)[1])
					.filter((remote): remote is string => Boolean(remote))
					.map(parse_github_repo)
					.filter((repo): repo is string => Boolean(repo)),
			),
		];
	} catch {
		return [];
	}
}

export function load_mcp_policy(
	cwd: string,
	include_project = true,
): Record<string, RawMcpPolicyEntry[]> {
	const global =
		read_policy_file(global_mcp_policy_path()).servers ?? {};
	const project = include_project
		? (read_policy_file(project_mcp_policy_path(cwd)).servers ?? {})
		: {};
	const names = new Set([
		...Object.keys(global),
		...Object.keys(project),
	]);
	return Object.fromEntries(
		Array.from(
			names,
			(name) =>
				[
					name,
					[global[name], project[name]].filter(
						(policy): policy is RawMcpPolicyEntry => Boolean(policy),
					),
				] as const,
		),
	);
}

export function policy_matches(
	policy: RawMcpPolicyEntry | undefined,
	cwd: string,
	github_repos: string[],
): boolean {
	if (!policy?.activateWhen) return true;
	const activate = policy.activateWhen;
	const github_org = as_string_array(
		activate.githubOrg,
		'githubOrg',
	)?.map((org) => org.toLowerCase());
	const github_repo = as_string_array(
		activate.githubRepo,
		'githubRepo',
	)?.map((repo) => repo.toLowerCase());
	const cwd_prefix = as_string_array(activate.cwdPrefix, 'cwdPrefix');
	const checks: boolean[] = [];
	if (github_org) {
		checks.push(
			github_repos.some((repo) =>
				github_org.includes(repo.split('/')[0]),
			),
		);
	}
	if (github_repo) {
		checks.push(
			github_repos.some((repo) => github_repo.includes(repo)),
		);
	}
	if (cwd_prefix) {
		checks.push(cwd_prefix.some((prefix) => cwd.startsWith(prefix)));
	}
	return checks.length === 0 || checks.some(Boolean);
}
