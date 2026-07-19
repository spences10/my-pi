import { spawn, spawnSync } from 'node:child_process';

export interface CommandResult {
	status: number | null;
	stdout: string;
	stderr: string;
	error?: Error;
}

export type CommandRunner = (
	command: string,
	args: string[],
) => CommandResult;

export type AsyncCommandRunner = (
	command: string,
	args: string[],
	options?: { signal?: AbortSignal },
) => Promise<CommandResult>;

export const default_runner: CommandRunner = (command, args) => {
	const result = spawnSync(command, args, {
		encoding: 'utf-8',
		windowsHide: true,
	});
	return {
		status: result.status,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
		error: result.error,
	};
};

export const default_async_runner: AsyncCommandRunner = (
	command,
	args,
	options,
) =>
	new Promise((resolve) => {
		const child = spawn(command, args, {
			windowsHide: true,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		let settled = false;

		const abort = () => {
			if (!child.killed) child.kill('SIGTERM');
		};
		if (options?.signal?.aborted) abort();
		options?.signal?.addEventListener('abort', abort, { once: true });

		child.stdout?.setEncoding('utf-8');
		child.stderr?.setEncoding('utf-8');
		child.stdout?.on('data', (chunk: string) => {
			stdout += chunk;
		});
		child.stderr?.on('data', (chunk: string) => {
			stderr += chunk;
		});
		child.on('error', (error) => {
			if (settled) return;
			settled = true;
			options?.signal?.removeEventListener('abort', abort);
			resolve({ status: null, stdout, stderr, error });
		});
		child.on('close', (status) => {
			if (settled) return;
			settled = true;
			options?.signal?.removeEventListener('abort', abort);
			resolve({ status, stdout, stderr });
		});
	});

export function command_output(result: CommandResult): string {
	return [result.stdout.trim(), result.stderr.trim()]
		.filter(Boolean)
		.join('\n');
}

export function ensure_success(
	result: CommandResult,
	fallback: string,
): string {
	if (result.status === 0) return command_output(result);
	const output = command_output(result);
	if (result.error) {
		throw new Error(`${fallback}: ${result.error.message}`);
	}
	throw new Error(output || fallback);
}

export async function ensure_success_async(
	result: Promise<CommandResult>,
	fallback: string,
): Promise<string> {
	return ensure_success(await result, fallback);
}

export function has_gh_skill(
	runner: CommandRunner = default_runner,
): boolean {
	const result = runner('gh', ['skill', '--help']);
	return result.status === 0;
}

export type GhSkillScope = 'project' | 'user';

export interface GhInstalledSkill {
	skillName: string;
	sourceURL: string;
	scope: GhSkillScope;
	version: string;
	pinned: boolean;
	path: string;
}

export function normalize_gh_installed_skill(
	value: unknown,
): GhInstalledSkill | null {
	if (!value || typeof value !== 'object') return null;
	const item = value as Record<string, unknown>;
	if (
		typeof item.skillName !== 'string' ||
		typeof item.sourceURL !== 'string' ||
		(item.scope !== 'project' && item.scope !== 'user') ||
		typeof item.version !== 'string' ||
		typeof item.pinned !== 'boolean' ||
		typeof item.path !== 'string'
	) {
		return null;
	}

	const skill_name = item.skillName.trim();
	const path = item.path.trim();
	if (!skill_name || !path) return null;

	return {
		skillName: skill_name,
		sourceURL: item.sourceURL.trim(),
		scope: item.scope,
		version: item.version.trim(),
		pinned: item.pinned,
		path,
	};
}

export function parse_gh_skill_list_output(
	output: string,
): GhInstalledSkill[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(output) as unknown;
	} catch (error) {
		const detail = error instanceof Error ? `: ${error.message}` : '';
		throw new Error(`Invalid gh skill list JSON${detail}`);
	}
	if (!Array.isArray(parsed)) {
		throw new Error('Invalid gh skill list JSON: expected an array');
	}

	return parsed.flatMap((item) => {
		const skill = normalize_gh_installed_skill(item);
		return skill ? [skill] : [];
	});
}

function gh_skill_list_args(): string[] {
	return [
		'skill',
		'list',
		'--agent',
		'pi',
		'--json',
		'skillName,sourceURL,scope,version,pinned,path',
	];
}

export function run_gh_skill_list(
	runner: CommandRunner = default_runner,
): GhInstalledSkill[] {
	const result = runner('gh', gh_skill_list_args());
	ensure_success(result, 'gh skill list failed');
	return parse_gh_skill_list_output(result.stdout);
}

export async function run_gh_skill_list_async(
	runner: AsyncCommandRunner = default_async_runner,
	options?: { signal?: AbortSignal },
): Promise<GhInstalledSkill[]> {
	const result = await runner('gh', gh_skill_list_args(), options);
	ensure_success(result, 'gh skill list failed');
	return parse_gh_skill_list_output(result.stdout);
}

export function is_github_repo_spec(value: string): boolean {
	return /^(?:https:\/\/github\.com\/)?[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(
		value,
	);
}

export function normalize_github_repo_spec(value: string): string {
	return value
		.replace(/^https:\/\/github\.com\//, '')
		.replace(/\.git$/, '');
}

export function github_repository_from_source_url(
	source_url: string,
): string | null {
	const value = source_url.trim();
	if (!value) return null;

	const shorthand = value.replace(/\/$/, '');
	if (is_github_repo_spec(shorthand)) {
		return normalize_github_repo_spec(shorthand);
	}

	try {
		const url = new URL(value);
		if (
			url.protocol !== 'https:' ||
			(url.hostname.toLowerCase() !== 'github.com' &&
				url.hostname.toLowerCase() !== 'www.github.com') ||
			url.port ||
			url.username ||
			url.password ||
			url.search ||
			url.hash
		) {
			return null;
		}
		const parts = url.pathname.split('/').filter(Boolean);
		if (parts.length !== 2) return null;
		const repository = `${parts[0]}/${parts[1]}`;
		if (!is_github_repo_spec(repository)) return null;
		return normalize_github_repo_spec(repository);
	} catch {
		return null;
	}
}

function parse_repo_parts(repository: string): {
	owner: string;
	repo: string;
} {
	const normalized = normalize_github_repo_spec(repository);
	const [owner, repo] = normalized.split('/');
	if (!owner || !repo) {
		throw new Error(`Invalid GitHub repository: ${repository}`);
	}
	return { owner, repo };
}

export interface GhSkillInstallRequest {
	repository: string;
	skill: string;
	flags: string[];
}

export function parse_gh_skill_install_args(
	parts: string[],
): GhSkillInstallRequest | null {
	if (parts.length < 2) return null;
	const [repository, skill, ...flags] = parts;
	if (!repository || !skill || !is_github_repo_spec(repository)) {
		return null;
	}
	return {
		repository: normalize_github_repo_spec(repository),
		skill,
		flags,
	};
}

function has_flag(flags: string[], name: string): boolean {
	return flags.some(
		(flag) => flag === name || flag.startsWith(`${name}=`),
	);
}

function build_gh_skill_install_args(
	request: GhSkillInstallRequest,
): string[] {
	const default_flags: string[] = [];
	if (
		!has_flag(request.flags, '--agent') &&
		!has_flag(request.flags, '--dir')
	) {
		default_flags.push('--agent', 'pi');
	}
	if (
		!has_flag(request.flags, '--scope') &&
		!has_flag(request.flags, '--dir')
	) {
		default_flags.push('--scope', 'user');
	}
	return [
		'skill',
		'install',
		normalize_github_repo_spec(request.repository),
		request.skill,
		...default_flags,
		...request.flags,
	];
}

export function run_gh_skill_install(
	request: GhSkillInstallRequest,
	runner: CommandRunner = default_runner,
): string {
	return ensure_success(
		runner('gh', build_gh_skill_install_args(request)),
		'gh skill install failed',
	);
}

export async function run_gh_skill_install_async(
	request: GhSkillInstallRequest,
	runner: AsyncCommandRunner = default_async_runner,
	options?: { signal?: AbortSignal },
): Promise<string> {
	return await ensure_success_async(
		runner('gh', build_gh_skill_install_args(request), options),
		'gh skill install failed',
	);
}

export interface GhRepositorySkill {
	name: string;
	path: string;
}

export interface GhKnownRepository {
	repository: string;
	source_url: string;
	source_urls: string[];
	scopes: GhSkillScope[];
	installed_skills: GhInstalledSkill[];
}

export interface GhRemoteRepositorySkills {
	repository: string;
	skills: readonly GhRepositorySkill[];
}

export interface GhAvailableRepositorySkill extends GhRepositorySkill {
	repository: string;
	source_url: string;
	source_urls: string[];
	repository_scopes: GhSkillScope[];
	repository_installations: GhInstalledSkill[];
}

export interface GhRepositorySkillReconciliation {
	known_repositories: GhKnownRepository[];
	available_skills: GhAvailableRepositorySkill[];
}

export function derive_known_github_repositories(
	installed_skills: readonly GhInstalledSkill[],
): GhKnownRepository[] {
	const by_repository = new Map<string, GhKnownRepository>();

	for (const skill of installed_skills) {
		const repository = github_repository_from_source_url(
			skill.sourceURL,
		);
		if (!repository) continue;
		const key = repository.toLowerCase();
		let known = by_repository.get(key);
		if (!known) {
			known = {
				repository,
				source_url: `https://github.com/${repository}`,
				source_urls: [],
				scopes: [],
				installed_skills: [],
			};
			by_repository.set(key, known);
		}
		const source_url = skill.sourceURL.trim();
		if (!known.source_urls.includes(source_url)) {
			known.source_urls.push(source_url);
		}
		if (!known.scopes.includes(skill.scope)) {
			known.scopes.push(skill.scope);
		}
		known.installed_skills.push(skill);
	}

	return [...by_repository.values()].sort((a, b) =>
		a.repository.localeCompare(b.repository),
	);
}

export function reconcile_github_repository_skills(
	installed_skills: readonly GhInstalledSkill[],
	remote_repositories: readonly GhRemoteRepositorySkills[],
): GhRepositorySkillReconciliation {
	const known_repositories =
		derive_known_github_repositories(installed_skills);
	const known_by_repository = new Map(
		known_repositories.map((repository) => [
			repository.repository.toLowerCase(),
			repository,
		]),
	);
	const seen = new Set<string>();
	const available_skills: GhAvailableRepositorySkill[] = [];

	for (const remote of remote_repositories) {
		const repository = github_repository_from_source_url(
			remote.repository,
		);
		if (!repository) continue;
		const known = known_by_repository.get(repository.toLowerCase());
		if (!known) continue;
		const installed_names = new Set(
			known.installed_skills.map((skill) => skill.skillName),
		);

		for (const skill of remote.skills) {
			if (installed_names.has(skill.name)) continue;
			const key = `${known.repository.toLowerCase()}\0${skill.path}`;
			if (seen.has(key)) continue;
			seen.add(key);
			available_skills.push({
				name: skill.name,
				path: skill.path,
				repository: known.repository,
				source_url: known.source_url,
				source_urls: [...known.source_urls],
				repository_scopes: [...known.scopes],
				repository_installations: [...known.installed_skills],
			});
		}
	}

	available_skills.sort((a, b) =>
		`${a.repository}\0${a.path}`.localeCompare(
			`${b.repository}\0${b.path}`,
		),
	);
	return { known_repositories, available_skills };
}

export interface GhSkillSearchResult {
	skillName: string;
	description: string;
	repo: string;
	path: string;
	stars: number;
	namespace: string;
}

interface GitHubRepositoryResponse {
	default_branch?: string;
}

interface GitHubTreeResponse {
	tree?: Array<{ path?: string; type?: string }>;
}

function parse_github_repository_skills(
	tree_output: string,
): GhRepositorySkill[] {
	const tree = JSON.parse(tree_output) as GitHubTreeResponse;
	return (tree.tree ?? [])
		.filter(
			(item) =>
				item.type === 'blob' && item.path?.endsWith('/SKILL.md'),
		)
		.map((item) => {
			const path = item.path!;
			return {
				path,
				name: path.split('/').at(-2) ?? path,
			};
		})
		.sort((a, b) => a.path.localeCompare(b.path));
}

function github_tree_args(
	owner: string,
	repo: string,
	tree_ref: string,
): string[] {
	return [
		'api',
		'--method',
		'GET',
		`repos/${owner}/${repo}/git/trees/${tree_ref}`,
		'-f',
		'recursive=1',
	];
}

export function list_github_repository_skills(
	repository: string,
	ref?: string,
	runner: CommandRunner = default_runner,
): GhRepositorySkill[] {
	const { owner, repo } = parse_repo_parts(repository);
	let tree_ref = ref?.trim();
	if (!tree_ref) {
		const repo_output = ensure_success(
			runner('gh', ['api', `repos/${owner}/${repo}`]),
			'gh api failed while reading repository metadata',
		);
		const metadata = JSON.parse(
			repo_output,
		) as GitHubRepositoryResponse;
		tree_ref = metadata.default_branch || 'HEAD';
	}

	const tree_output = ensure_success(
		runner('gh', github_tree_args(owner, repo, tree_ref)),
		'gh api failed while listing repository skills',
	);
	return parse_github_repository_skills(tree_output);
}

export async function list_github_repository_skills_async(
	repository: string,
	ref?: string,
	runner: AsyncCommandRunner = default_async_runner,
	options?: { signal?: AbortSignal },
): Promise<GhRepositorySkill[]> {
	const { owner, repo } = parse_repo_parts(repository);
	let tree_ref = ref?.trim();
	if (!tree_ref) {
		const repo_output = await ensure_success_async(
			runner('gh', ['api', `repos/${owner}/${repo}`], options),
			'gh api failed while reading repository metadata',
		);
		const metadata = JSON.parse(
			repo_output,
		) as GitHubRepositoryResponse;
		tree_ref = metadata.default_branch || 'HEAD';
	}

	const tree_output = await ensure_success_async(
		runner('gh', github_tree_args(owner, repo, tree_ref), options),
		'gh api failed while listing repository skills',
	);
	return parse_github_repository_skills(tree_output);
}

function normalize_search_result(
	value: unknown,
): GhSkillSearchResult | null {
	if (!value || typeof value !== 'object') return null;
	const item = value as Record<string, unknown>;
	if (
		typeof item.skillName !== 'string' ||
		typeof item.repo !== 'string' ||
		typeof item.path !== 'string'
	) {
		return null;
	}
	return {
		skillName: item.skillName,
		description:
			typeof item.description === 'string' ? item.description : '',
		repo: item.repo,
		path: item.path,
		stars: typeof item.stars === 'number' ? item.stars : 0,
		namespace:
			typeof item.namespace === 'string' ? item.namespace : '',
	};
}

function search_args(query: string, limit: number): string[] {
	return [
		'skill',
		'search',
		query,
		'--limit',
		String(limit),
		'--json',
		'skillName,description,repo,path,stars,namespace',
	];
}

function parse_search_output(output: string): GhSkillSearchResult[] {
	const parsed = JSON.parse(output) as unknown;
	return Array.isArray(parsed)
		? parsed.flatMap((item) => {
				const result = normalize_search_result(item);
				return result ? [result] : [];
			})
		: [];
}

export function run_gh_skill_search(
	query: string,
	limit = 15,
	runner: CommandRunner = default_runner,
): GhSkillSearchResult[] {
	const output = ensure_success(
		runner('gh', search_args(query.trim(), limit)),
		'gh skill search failed',
	);
	return parse_search_output(output);
}

export async function run_gh_skill_search_async(
	query: string,
	limit = 15,
	runner: AsyncCommandRunner = default_async_runner,
	options?: { signal?: AbortSignal },
): Promise<GhSkillSearchResult[]> {
	const output = await ensure_success_async(
		runner('gh', search_args(query.trim(), limit), options),
		'gh skill search failed',
	);
	return parse_search_output(output);
}

export function run_gh_skill_preview(
	repository: string,
	skill: string,
	runner: CommandRunner = default_runner,
): string {
	return ensure_success(
		runner('gh', ['skill', 'preview', repository, skill]),
		'gh skill preview failed',
	);
}

export async function run_gh_skill_preview_async(
	repository: string,
	skill: string,
	runner: AsyncCommandRunner = default_async_runner,
	options?: { signal?: AbortSignal },
): Promise<string> {
	return await ensure_success_async(
		runner('gh', ['skill', 'preview', repository, skill], options),
		'gh skill preview failed',
	);
}

export function run_gh_skill_update(
	args: string[],
	runner: CommandRunner = default_runner,
): string {
	return ensure_success(
		runner('gh', ['skill', 'update', ...args]),
		'gh skill update failed',
	);
}

export async function run_gh_skill_update_async(
	args: string[],
	runner: AsyncCommandRunner = default_async_runner,
	options?: { signal?: AbortSignal },
): Promise<string> {
	return await ensure_success_async(
		runner('gh', ['skill', 'update', ...args], options),
		'gh skill update failed',
	);
}
