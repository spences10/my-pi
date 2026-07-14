import { createHash, randomUUID } from 'node:crypto';
import {
	closeSync,
	existsSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import {
	basename,
	dirname,
	join,
	relative,
	resolve,
} from 'node:path';
import { validate_repository_policy } from './policy.js';
import type {
	ApprovalAction,
	RepositoryPolicy,
	ValidationGate,
} from './types.js';

export type PolicyConfidence = 'low' | 'medium' | 'high';
export interface PolicyEvidence {
	id: string;
	kind:
		| 'package-script'
		| 'workspace'
		| 'ci'
		| 'ownership'
		| 'database'
		| 'release'
		| 'agent-instruction'
		| 'harness'
		| 'existing-policy';
	path: string;
	summary: string;
	confidence: PolicyConfidence;
}
export interface PolicyInference {
	field: string;
	value: unknown;
	evidence_ids: string[];
	confidence: PolicyConfidence;
}
export interface PolicyQuestion {
	id: string;
	field: string;
	message: string;
	evidence_ids: string[];
}
export interface PolicyDrift {
	field: string;
	status:
		| 'added'
		| 'changed'
		| 'preserved-manual'
		| 'removed-evidence';
	current?: unknown;
	discovered?: unknown;
}
export interface PolicyDraftDecision {
	draft_id: string;
	decision: 'rejected';
	reason: string;
	decided_at: string;
}
export interface RepositoryPolicyDraft {
	schema_version: 1;
	draft_id: string;
	root: string;
	created_at: string;
	base_policy_hash: string | null;
	policy: RepositoryPolicy;
	evidence: PolicyEvidence[];
	inferences: PolicyInference[];
	questions: PolicyQuestion[];
	drift: PolicyDrift[];
	activation: { required: true; target: string };
}

const ignored_directories = new Set([
	'.git',
	'node_modules',
	'dist',
	'build',
	'.svelte-kit',
	'coverage',
]);
const validation_script = /^(test|check|lint|typecheck)(?::|$)/;
const migration_name = /^(migrations?|prisma|drizzle|database|db)$/i;
const release_name = /^(deploy|release|publish)(?::|$)/;
const safe_script_name =
	/^(test|check|lint|typecheck)(?::[a-zA-Z0-9_-]+)*$/;
const safe_path_segment = /^[a-zA-Z0-9._@-]+$/;
const safe_validation_token =
	'(?:test|check|lint|typecheck)(?::[a-zA-Z0-9_-]+)*';
const safe_selector = '[a-zA-Z0-9._@/*-]+';
const safe_ci_commands = [
	new RegExp(
		`^pnpm (?:--filter ${safe_selector} )?${safe_validation_token}$`,
	),
	new RegExp(
		`^pnpm --dir ${safe_selector} ${safe_validation_token}$`,
	),
	new RegExp(
		`^npm (?:--workspace ${safe_selector} )?run ${safe_validation_token}$`,
	),
	new RegExp(
		`^npm (?:test|run (?:check|lint|typecheck)(?::[a-zA-Z0-9_-]+)*)$`,
	),
	new RegExp(
		`^yarn (?:--cwd ${safe_selector} )?${safe_validation_token}$`,
	),
	new RegExp(
		`^bun (?:--cwd ${safe_selector} )?run ${safe_validation_token}$`,
	),
];

function safe_files(root: string, max_depth = 5): string[] {
	const files: string[] = [];
	function visit(directory: string, depth: number) {
		if (depth > max_depth) return;
		for (const entry of readdirSync(directory, {
			withFileTypes: true,
		})) {
			if (entry.isSymbolicLink()) continue;
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				if (!ignored_directories.has(entry.name))
					visit(path, depth + 1);
			} else if (entry.isFile()) files.push(path);
		}
	}
	visit(root, 0);
	return files;
}
function read_text(
	path: string,
	max_bytes = 256_000,
): string | undefined {
	try {
		if (statSync(path).size > max_bytes) return undefined;
		return readFileSync(path, 'utf8');
	} catch {
		return undefined;
	}
}
function evidence(
	items: PolicyEvidence[],
	root: string,
	kind: PolicyEvidence['kind'],
	path: string,
	summary: string,
	confidence: PolicyConfidence,
): string {
	const id = `evidence-${items.length + 1}`;
	items.push({
		id,
		kind,
		path: relative(root, path) || '.',
		summary,
		confidence,
	});
	return id;
}
function unique<T>(values: T[]): T[] {
	return [...new Set(values)];
}
function stable(value: unknown): string {
	return JSON.stringify(value);
}
function hash(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}
function policy_content(root: string): string | undefined {
	return read_text(join(root, '.pi', 'factory.json'));
}
function safe_relative_directory(value: string): boolean {
	return (
		!value ||
		value.split('/').every((part) => safe_path_segment.test(part))
	);
}
function package_manager(
	root: string,
): 'pnpm' | 'npm' | 'yarn' | 'bun' {
	if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
	if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
	if (
		existsSync(join(root, 'bun.lock')) ||
		existsSync(join(root, 'bun.lockb'))
	)
		return 'bun';
	return 'npm';
}
function package_command(
	manager: 'pnpm' | 'npm' | 'yarn' | 'bun',
	directory: string,
	script: string,
): string {
	if (manager === 'pnpm')
		return directory
			? `pnpm --dir ${directory} ${script}`
			: `pnpm ${script}`;
	if (manager === 'npm')
		return directory
			? `npm --prefix ${directory} run ${script}`
			: `npm run ${script}`;
	if (manager === 'yarn')
		return directory
			? `yarn --cwd ${directory} ${script}`
			: `yarn ${script}`;
	return directory
		? `bun --cwd ${directory} run ${script}`
		: `bun run ${script}`;
}
function is_safe_ci_command(command: string): boolean {
	return safe_ci_commands.some((pattern) => pattern.test(command));
}
function safe_policy_target(trusted_root_path: string): {
	trusted_root: string;
	target: string;
} {
	const trusted_root = realpathSync(resolve(trusted_root_path));
	const policy_directory = join(trusted_root, '.pi');
	if (
		existsSync(policy_directory) &&
		lstatSync(policy_directory).isSymbolicLink()
	)
		throw new Error(
			'Repository policy directory must not be a symbolic link',
		);
	mkdirSync(policy_directory, { recursive: true });
	if (realpathSync(policy_directory) !== policy_directory)
		throw new Error(
			'Repository policy directory escapes the trusted root',
		);
	const target = join(policy_directory, 'factory.json');
	if (existsSync(target) && lstatSync(target).isSymbolicLink())
		throw new Error(
			'Repository policy file must not be a symbolic link',
		);
	return { trusted_root, target };
}
function ci_run_values(text: string): string[] {
	const lines = text.split(/\r?\n/);
	const values: string[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const match = /^([ \t]*)-?[ \t]*run:[ \t]*(.*)$/.exec(
			lines[index]!,
		);
		if (!match) continue;
		const value = match[2]!.trim();
		if (value === '|' || value === '>') {
			const indentation = match[1]!.length;
			while (index + 1 < lines.length) {
				const next = lines[index + 1]!;
				const leading = /^\s*/.exec(next)![0].length;
				if (next.trim() && leading <= indentation) break;
				index += 1;
				if (next.trim()) values.push(next.trim());
			}
		} else if (value) values.push(value.replace(/^['"]|['"]$/g, ''));
	}
	return values;
}
function top_level_drift(
	current: RepositoryPolicy | undefined,
	discovered: RepositoryPolicy,
	reconciled: RepositoryPolicy,
): PolicyDrift[] {
	if (!current) return [];
	const keys = new Set([
		...Object.keys(current),
		...Object.keys(discovered),
	]);
	keys.delete('policy_id');
	keys.delete('schema_version');
	const drift: PolicyDrift[] = [];
	for (const field of keys) {
		const before = current[field as keyof RepositoryPolicy];
		const after = discovered[field as keyof RepositoryPolicy];
		if (stable(before) === stable(after)) continue;
		const resolved = reconciled[field as keyof RepositoryPolicy];
		drift.push({
			field,
			status:
				before === undefined
					? 'added'
					: after === undefined
						? 'removed-evidence'
						: stable(resolved) === stable(before)
							? 'preserved-manual'
							: 'changed',
			current: before,
			discovered: after,
		});
	}
	return drift;
}

export function discover_repository_policy(
	root_path: string,
	options: { current_policy?: RepositoryPolicy } = {},
): RepositoryPolicyDraft {
	const root = resolve(root_path);
	if (!existsSync(root) || !statSync(root).isDirectory())
		throw new Error(`Repository root does not exist: ${root}`);
	const files = safe_files(root);
	const manager = package_manager(root);
	const evidence_items: PolicyEvidence[] = [];
	const inferences: PolicyInference[] = [];
	const questions: PolicyQuestion[] = [];
	const validations: ValidationGate[] = [];
	const risky_paths: string[] = [];
	const required_approvals = new Set<ApprovalAction>();
	const command_sources = new Map<string, string[]>();
	const root_evidence = evidence(
		evidence_items,
		root,
		'workspace',
		root,
		'Repository root used for policy discovery',
		'high',
	);
	inferences.push(
		{
			field: 'schema_version',
			value: 1,
			evidence_ids: [root_evidence],
			confidence: 'high',
		},
		{
			field: 'policy_id',
			value: 'generated discovery identity',
			evidence_ids: [root_evidence],
			confidence: 'high',
		},
	);

	for (const path of files.filter(
		(item) => basename(item) === 'package.json',
	)) {
		const source = read_text(path);
		if (!source) continue;
		let manifest: {
			scripts?: Record<string, unknown>;
			workspaces?: unknown;
		};
		try {
			manifest = JSON.parse(source) as typeof manifest;
		} catch {
			questions.push({
				id: `question-${questions.length + 1}`,
				field: 'validations',
				message: `Could not parse ${relative(root, path)}; review it manually.`,
				evidence_ids: [],
			});
			continue;
		}
		if (manifest.workspaces)
			evidence(
				evidence_items,
				root,
				'workspace',
				path,
				'Workspace topology declared',
				'high',
			);
		for (const [name, value] of Object.entries(
			manifest.scripts ?? {},
		)) {
			if (typeof value !== 'string') continue;
			if (validation_script.test(name)) {
				const id = evidence(
					evidence_items,
					root,
					'package-script',
					path,
					`Validation script ${name}`,
					'high',
				);
				const directory = relative(root, dirname(path)).replaceAll(
					'\\',
					'/',
				);
				if (
					!safe_script_name.test(name) ||
					!safe_relative_directory(directory)
				) {
					questions.push({
						id: `question-${questions.length + 1}`,
						field: 'validations',
						message: `Unsafe validation script name or package path in ${relative(root, path)} was not converted into an executable command.`,
						evidence_ids: [id],
					});
					continue;
				}
				const command = package_command(manager, directory, name);
				command_sources.set(command, [
					...(command_sources.get(command) ?? []),
					id,
				]);
			}
			if (release_name.test(name)) {
				const id = evidence(
					evidence_items,
					root,
					'release',
					path,
					`Consequential script ${name}`,
					'high',
				);
				required_approvals.add(
					name.startsWith('deploy')
						? 'deploy'
						: name.startsWith('publish')
							? 'release'
							: 'release',
				);
				inferences.push({
					field: 'required_approvals',
					value: [...required_approvals],
					evidence_ids: [id],
					confidence: 'high',
				});
			}
		}
	}
	for (const [command, ids] of command_sources) {
		validations.push({
			id: `discovered-${validations.length + 1}`,
			execution: 'shell',
			command,
			source: command.includes('test') ? 'test' : 'check',
			required: true,
		});
		inferences.push({
			field: 'validations',
			value: command,
			evidence_ids: ids,
			confidence: 'high',
		});
	}

	for (const path of files) {
		const rel = relative(root, path);
		const parts = rel.split(/[\\/]/);
		const directory = parts.find((part) => migration_name.test(part));
		if (directory) {
			const pattern = `${parts.slice(0, parts.indexOf(directory) + 1).join('/')}/**`;
			if (!risky_paths.includes(pattern)) {
				const id = evidence(
					evidence_items,
					root,
					'database',
					path,
					`Database or migration surface ${pattern}`,
					'high',
				);
				risky_paths.push(pattern);
				inferences.push({
					field: 'risky_paths',
					value: pattern,
					evidence_ids: [id],
					confidence: 'high',
				});
			}
		}
		if (/^\.github\/workflows\/.+\.ya?ml$/.test(rel)) {
			const text = read_text(path);
			if (!text) continue;
			const id = evidence(
				evidence_items,
				root,
				'ci',
				path,
				'CI workflow inspected as text',
				'medium',
			);
			const run_values = ci_run_values(text);
			const ci_commands = run_values.filter(is_safe_ci_command);
			for (const command of run_values.filter(
				(command) => !is_safe_ci_command(command),
			))
				questions.push({
					id: `question-${questions.length + 1}`,
					field: 'validations',
					message: `CI command was not converted into an executable validation because it is not an exact allowlisted package-manager validation: ${command}`,
					evidence_ids: [id],
				});
			for (const command of ci_commands)
				if (!validations.some((gate) => gate.command === command)) {
					validations.push({
						id: `discovered-${validations.length + 1}`,
						execution: 'shell',
						command,
						source: command.includes('test') ? 'test' : 'check',
						required: true,
					});
					inferences.push({
						field: 'validations',
						value: command,
						evidence_ids: [id],
						confidence: 'medium',
					});
				}
			if (/\b(deploy|publish|release)\b/i.test(text)) {
				required_approvals.add(
					/\bdeploy\b/i.test(text) ? 'deploy' : 'release',
				);
				inferences.push({
					field: 'required_approvals',
					value: [...required_approvals],
					evidence_ids: [id],
					confidence: 'medium',
				});
			}
		}
		if (basename(path) === 'CODEOWNERS')
			evidence(
				evidence_items,
				root,
				'ownership',
				path,
				'Ownership rules present; factory policy cannot encode owners yet',
				'high',
			);
		if (/^(AGENTS|CLAUDE)\.md$/i.test(basename(path)))
			evidence(
				evidence_items,
				root,
				'agent-instruction',
				path,
				'Agent instructions present; retained as review evidence only',
				'medium',
			);
		if (parts.includes('.pi') && parts.includes('harness'))
			evidence(
				evidence_items,
				root,
				'harness',
				path,
				'Existing harness evidence present',
				'medium',
			);
	}

	if (evidence_items.some((item) => item.kind === 'ownership'))
		questions.push({
			id: `question-${questions.length + 1}`,
			field: 'ownership',
			message:
				'CODEOWNERS was found, but repository policy schema v1 has no ownership field. Confirm ownership handling outside the generated policy.',
			evidence_ids: evidence_items
				.filter((item) => item.kind === 'ownership')
				.map((item) => item.id),
		});
	const script_commands = new Set(command_sources.keys());
	const ci_commands = new Set(
		validations
			.filter((gate) => !script_commands.has(gate.command ?? ''))
			.map((gate) => gate.command),
	);
	if (script_commands.size && ci_commands.size)
		questions.push({
			id: `question-${questions.length + 1}`,
			field: 'validations',
			message:
				'CI and package scripts contain different validation commands. Review which commands should be authoritative.',
			evidence_ids: inferences
				.filter((item) => item.field === 'validations')
				.flatMap((item) => item.evidence_ids),
		});

	const discovered: RepositoryPolicy = {
		schema_version: 1,
		policy_id: `discovered@${new Date().toISOString()}`,
		...(validations.length ? { validations } : {}),
		...(risky_paths.length
			? { risky_paths: unique(risky_paths) }
			: {}),
		...(required_approvals.size
			? { required_approvals: [...required_approvals] }
			: {}),
	};
	const current = options.current_policy;
	if (current) {
		const current_evidence = evidence(
			evidence_items,
			root,
			'existing-policy',
			join(root, '.pi', 'factory.json'),
			'Existing reviewed repository policy preserved during reconciliation',
			'high',
		);
		for (const [field, value] of Object.entries(current))
			inferences.push({
				field,
				value,
				evidence_ids: [current_evidence],
				confidence: 'high',
			});
	}
	const policy: RepositoryPolicy = current
		? {
				...discovered,
				...current,
				schema_version: 1,
				policy_id: current.policy_id,
				validations: unique(
					[
						...(current.validations ?? []),
						...(discovered.validations ?? []),
					].map((gate) => JSON.stringify(gate)),
				).map((gate) => JSON.parse(gate) as ValidationGate),
				risky_paths: unique([
					...(current.risky_paths ?? []),
					...(discovered.risky_paths ?? []),
				]),
				required_approvals: unique([
					...(current.required_approvals ?? []),
					...(discovered.required_approvals ?? []),
				]),
			}
		: discovered;
	validate_repository_policy(policy);
	const existing_content = policy_content(root);
	return {
		schema_version: 1,
		draft_id: randomUUID(),
		root,
		created_at: new Date().toISOString(),
		base_policy_hash:
			existing_content === undefined ? null : hash(existing_content),
		policy,
		evidence: evidence_items,
		inferences,
		questions,
		drift: top_level_drift(current, discovered, policy),
		activation: {
			required: true,
			target: join(root, '.pi', 'factory.json'),
		},
	};
}

export function validate_policy_draft(
	draft: RepositoryPolicyDraft,
): void {
	if (
		draft.schema_version !== 1 ||
		!draft.activation?.required ||
		!(
			draft.base_policy_hash === null ||
			/^[a-f0-9]{64}$/.test(draft.base_policy_hash)
		)
	)
		throw new Error('Invalid repository policy draft');
	validate_repository_policy(draft.policy);
}

export function reject_policy_draft(
	draft: RepositoryPolicyDraft,
	reason: string,
): PolicyDraftDecision {
	validate_policy_draft(draft);
	if (!reason.trim())
		throw new Error('Policy rejection reason is required');
	return {
		draft_id: draft.draft_id,
		decision: 'rejected',
		reason: reason.trim(),
		decided_at: new Date().toISOString(),
	};
}

export function activate_policy_draft(
	draft: RepositoryPolicyDraft,
	options: {
		trusted_root: string;
		authorization: {
			kind: 'extension-ui-confirmation' | 'embedding-application';
			actor: string;
		};
	},
): string {
	validate_policy_draft(draft);
	if (!options.authorization.actor.trim())
		throw new Error(
			'Authenticated policy activation actor is required',
		);
	const { trusted_root, target } = safe_policy_target(
		options.trusted_root,
	);
	const draft_root = realpathSync(resolve(draft.root));
	const requested_target = resolve(draft.activation.target);
	if (draft_root !== trusted_root || requested_target !== target)
		throw new Error(
			'Draft is not bound to the trusted repository root',
		);
	const lock_path = `${target}.lock`;
	let lock: number;
	try {
		lock = openSync(lock_path, 'wx', 0o600);
	} catch {
		throw new Error(
			'Repository policy activation is already in progress',
		);
	}
	const temporary = `${target}.${randomUUID()}.tmp`;
	let temporary_handle: number | undefined;
	try {
		const current_content = policy_content(trusted_root);
		const current_hash =
			current_content === undefined ? null : hash(current_content);
		if (current_hash !== draft.base_policy_hash)
			throw new Error(
				'Repository policy changed after discovery; regenerate before activation',
			);
		temporary_handle = openSync(temporary, 'wx', 0o600);
		writeFileSync(
			temporary_handle,
			`${JSON.stringify(draft.policy, null, 2)}\n`,
		);
		closeSync(temporary_handle);
		temporary_handle = undefined;
		const latest_content = policy_content(trusted_root);
		const latest_hash =
			latest_content === undefined ? null : hash(latest_content);
		if (latest_hash !== draft.base_policy_hash)
			throw new Error(
				'Repository policy changed during activation; regenerate before activation',
			);
		renameSync(temporary, target);
		return target;
	} finally {
		if (temporary_handle !== undefined) closeSync(temporary_handle);
		closeSync(lock);
		if (existsSync(temporary)) unlinkSync(temporary);
		unlinkSync(lock_path);
	}
}

export function discover_with_existing_policy(
	root_path: string,
): RepositoryPolicyDraft {
	const path = join(resolve(root_path), '.pi', 'factory.json');
	let current_policy: RepositoryPolicy | undefined;
	let current_content: string | undefined;
	if (existsSync(path)) {
		current_content = readFileSync(path, 'utf8');
		const parsed = JSON.parse(current_content) as unknown;
		validate_repository_policy(parsed);
		current_policy = parsed;
	}
	const draft = discover_repository_policy(root_path, {
		current_policy,
	});
	draft.base_policy_hash =
		current_content === undefined ? null : hash(current_content);
	return draft;
}
