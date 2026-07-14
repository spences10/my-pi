import { createHash, randomUUID } from 'node:crypto';
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { dispatch_task } from './dispatch.js';
import type {
	ApprovalAction,
	RepositoryPolicy,
	ResolvedRoute,
	Risk,
	RouteOverride,
	TaskIntake,
	WorkflowKind,
} from './types.js';

export type IntakeConfidence = 'low' | 'medium' | 'high';
export type ExternalSourceKind =
	| 'github'
	| 'incident'
	| 'support'
	| 'project-management';
export type ExternalLifecycle =
	| 'open'
	| 'closed'
	| 'cancelled'
	| 'reopened';
export interface ExternalSourceIdentity {
	kind: ExternalSourceKind;
	provider: string;
	project: string;
	id: string;
	url?: string;
}
export interface IntakeFact {
	field: string;
	value: unknown;
	origin: 'source';
	trusted: boolean;
}
export interface IntakeDerivation {
	field: string;
	value: unknown;
	confidence: IntakeConfidence;
	rationale: string;
	fact_fields: string[];
}
export interface CanonicalExternalIntake {
	schema_version: 1;
	intake_id: string;
	source: ExternalSourceIdentity;
	source_revision: string;
	delivery_id: string;
	received_at: string;
	lifecycle: ExternalLifecycle;
	facts: IntakeFact[];
	derivations: IntakeDerivation[];
	untrusted_content: {
		title: string;
		body?: string;
		attachments: string[];
	};
	intake: TaskIntake;
	requires_preview: true;
}
export interface IntakePreview {
	preview_token: string;
	canonical: CanonicalExternalIntake;
	source_facts: IntakeFact[];
	derived_assumptions: IntakeDerivation[];
	human_overrides: Partial<TaskIntake>;
	resolved: TaskIntake;
	warnings: string[];
}
export interface ExternalRoutePreview {
	preview: IntakePreview;
	route: ResolvedRoute;
}
export interface GithubWorkItem {
	repository: string;
	number: number;
	kind: 'issue' | 'pull-request';
	url: string;
	title: string;
	body?: string;
	author: string;
	updated_at: string;
	state: 'open' | 'closed';
	labels?: string[];
	changed_paths?: string[];
	attachments?: string[];
	delivery_id?: string;
}
export interface IncidentWorkItem {
	project: string;
	id: string;
	url?: string;
	title: string;
	description?: string;
	severity?: 'sev1' | 'sev2' | 'sev3' | 'sev4' | 'unknown';
	status: 'triggered' | 'resolved' | 'cancelled' | 'reopened';
	updated_at: string;
	affected_paths?: string[];
	attachments?: string[];
	delivery_id?: string;
}
export interface IntakeAdapter<T> {
	kind: ExternalSourceKind;
	adapt(
		input: T,
		context: {
			cwd: string;
			known_projects: Record<string, string>;
			trusted_source?: boolean;
		},
	): CanonicalExternalIntake;
}
export interface IntakeLedgerRevision {
	source_revision: string;
	delivery_id: string;
	payload_hash: string;
	intake_id: string;
	received_at: string;
	lifecycle: ExternalLifecycle;
}
export interface IntakeLedgerEntry {
	source: ExternalSourceIdentity;
	revisions: IntakeLedgerRevision[];
	current: CanonicalExternalIntake;
	workflow_id?: string;
	workflow_action:
		| 'create'
		| 'update'
		| 'pause'
		| 'cancel'
		| 'resume'
		| 'none';
}
interface IntakeLedgerFile {
	schema_version: 1;
	entries: Record<string, IntakeLedgerEntry>;
}

const github_workflow_labels: Record<string, WorkflowKind> = {
	bug: 'ambiguous-bug',
	incident: 'incident',
	architecture: 'architecture',
	release: 'safe-release',
	database: 'database-migration',
	ui: 'ui-copy',
};
const risk_labels: Record<string, Risk> = {
	'critical-risk': 'critical',
	'high-risk': 'high',
	'medium-risk': 'medium',
	'low-risk': 'low',
};
const severity_risk: Record<string, Risk> = {
	sev1: 'critical',
	sev2: 'high',
	sev3: 'medium',
	sev4: 'low',
	unknown: 'medium',
};
function stable(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stable);
	if (value && typeof value === 'object')
		return Object.fromEntries(
			Object.entries(value)
				.filter(([, item]) => item !== undefined)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, item]) => [key, stable(item)]),
		);
	return value;
}
function sha(value: unknown): string {
	return createHash('sha256')
		.update(JSON.stringify(stable(value)))
		.digest('hex');
}
function source_key(source: ExternalSourceIdentity): string {
	return `${source.kind}:${source.provider}:${source.project}:${source.id}`;
}
export function external_workflow_id(
	source: ExternalSourceIdentity,
): string {
	const value = sha(source);
	return `${value.slice(0, 8)}-${value.slice(8, 12)}-5${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20, 32)}`;
}
function project_cwd(
	project: string,
	context: { cwd: string; known_projects: Record<string, string> },
): string {
	const target = context.known_projects[project];
	if (!target)
		throw new Error(
			`No trusted repository mapping for external project ${project}`,
		);
	const root = resolve(context.cwd);
	const resolved = resolve(root, target);
	if (!existsSync(root) || !existsSync(resolved))
		throw new Error(
			'Trusted project mapping must reference an existing repository',
		);
	const canonical_root = realpathSync(root);
	const canonical_target = realpathSync(resolved);
	if (
		canonical_target !== canonical_root &&
		!canonical_target.startsWith(`${canonical_root}/`)
	)
		throw new Error(
			'Trusted project mapping escapes the configured workspace',
		);
	return canonical_target;
}
function lifecycle_for_github(
	state: GithubWorkItem['state'],
): ExternalLifecycle {
	return state === 'closed' ? 'closed' : 'open';
}
function lifecycle_for_incident(
	status: IncidentWorkItem['status'],
): ExternalLifecycle {
	if (status === 'resolved') return 'closed';
	if (status === 'cancelled') return 'cancelled';
	if (status === 'reopened') return 'reopened';
	return 'open';
}
function bounded_text(
	value: unknown,
	name: string,
	maximum: number,
): string {
	if (
		typeof value !== 'string' ||
		!value.trim() ||
		value.length > maximum
	)
		throw new Error(`${name} must be a bounded non-empty string`);
	return value;
}
function optional_text(
	value: unknown,
	name: string,
	maximum: number,
): string | undefined {
	if (value === undefined) return undefined;
	return bounded_text(value, name, maximum);
}
function requested_actions(labels: string[]): ApprovalAction[] {
	const actions: ApprovalAction[] = [];
	if (labels.includes('request:commit')) actions.push('commit');
	if (labels.includes('request:push')) actions.push('push');
	if (labels.includes('request:deploy')) actions.push('deploy');
	if (labels.includes('request:release')) actions.push('release');
	return actions;
}
function external_task(source: ExternalSourceIdentity): string {
	return `[Untrusted external ${source.project}#${source.id}] Review work item`;
}
function affected_path_refs(
	values: string[] | undefined,
): string[] | undefined {
	if (values === undefined) return undefined;
	if (
		!Array.isArray(values) ||
		values.some((value) => typeof value !== 'string') ||
		values.length > 1000 ||
		values.some(
			(value) =>
				!value ||
				value.length > 2048 ||
				value.startsWith('/') ||
				value.split('/').includes('..') ||
				/[;&|`$<>\n\r]/.test(value),
		)
	)
		throw new Error(
			'Affected paths must be bounded repository-relative references',
		);
	return [...new Set(values)];
}
function attachment_refs(values: string[] | undefined): string[] {
	const attachments = values ?? [];
	if (
		!Array.isArray(attachments) ||
		attachments.some((value) => typeof value !== 'string')
	)
		throw new Error('Attachments must be an array of references');
	if (attachments.length > 20)
		throw new Error('External intake attachment limit exceeded');
	if (
		attachments.some(
			(value) => value.length > 2048 || !/^https?:\/\//.test(value),
		)
	)
		throw new Error('Attachments must be bounded HTTP(S) references');
	return attachments;
}

export const github_intake_adapter: IntakeAdapter<GithubWorkItem> = {
	kind: 'github',
	adapt(input, context) {
		if (!Number.isInteger(input.number) || input.number < 1)
			throw new Error('Invalid GitHub work item number');
		bounded_text(input.repository, 'GitHub repository', 512);
		bounded_text(input.url, 'GitHub URL', 2048);
		bounded_text(input.title, 'GitHub title', 32_768);
		optional_text(input.body, 'GitHub body', 1_048_576);
		bounded_text(input.author, 'GitHub author', 512);
		if (!Number.isFinite(Date.parse(input.updated_at)))
			throw new Error('GitHub update timestamp is invalid');
		if (!['issue', 'pull-request'].includes(input.kind))
			throw new Error('GitHub work item kind is invalid');
		if (!['open', 'closed'].includes(input.state))
			throw new Error('GitHub work item state is invalid');
		if (
			input.labels !== undefined &&
			(!Array.isArray(input.labels) ||
				input.labels.length > 100 ||
				input.labels.some(
					(label) => typeof label !== 'string' || label.length > 256,
				))
		)
			throw new Error('GitHub labels must be bounded strings');
		const labels = [...new Set(input.labels ?? [])].map((label) =>
			label.toLowerCase(),
		);
		const source: ExternalSourceIdentity = {
			kind: 'github',
			provider: 'github',
			project: input.repository,
			id: String(input.number),
			url: input.url,
		};
		const trusted_source = context.trusted_source === true;
		const workflow_entries = (trusted_source ? labels : [])
			.map((label) => github_workflow_labels[label])
			.filter((value): value is WorkflowKind => Boolean(value));
		const risk_entries = (trusted_source ? labels : [])
			.map((label) => risk_labels[label])
			.filter((value): value is Risk => Boolean(value));
		const derivations: IntakeDerivation[] = trusted_source
			? []
			: [
					{
						field: 'source_authentication',
						value: 'operator-review-required',
						confidence: 'low',
						rationale:
							'External payload provenance was not authenticated by an embedding adapter',
						fact_fields: ['labels', 'author'],
					},
				];
		if (workflow_entries.length === 1)
			derivations.push({
				field: 'hints.workflow',
				value: workflow_entries[0],
				confidence: 'high',
				rationale: 'Allowlisted GitHub label',
				fact_fields: ['labels'],
			});
		if (risk_entries.length === 1)
			derivations.push({
				field: 'hints.risk',
				value: risk_entries[0],
				confidence: 'high',
				rationale: 'Allowlisted GitHub risk label',
				fact_fields: ['labels'],
			});
		if (workflow_entries.length > 1 || risk_entries.length > 1)
			derivations.push({
				field: 'conflict',
				value: { workflows: workflow_entries, risks: risk_entries },
				confidence: 'high',
				rationale:
					'Conflicting trusted labels require human resolution',
				fact_fields: ['labels'],
			});
		const intake: TaskIntake = {
			task: external_task(source),
			cwd: project_cwd(input.repository, context),
			affected_paths: trusted_source
				? affected_path_refs(input.changed_paths)
				: undefined,
			requested_side_effects: trusted_source
				? requested_actions(labels)
				: [],
			hints: {
				...(workflow_entries.length === 1
					? { workflow: workflow_entries[0] }
					: {}),
				...(risk_entries.length === 1
					? { risk: risk_entries[0] }
					: {}),
			},
		};
		return {
			schema_version: 1,
			intake_id: randomUUID(),
			source,
			source_revision: input.updated_at,
			delivery_id: input.delivery_id ?? `github:${input.updated_at}`,
			received_at: new Date().toISOString(),
			lifecycle: trusted_source
				? lifecycle_for_github(input.state)
				: 'open',
			facts: [
				{
					field: 'author',
					value: input.author,
					origin: 'source',
					trusted: false,
				},
				{
					field: 'labels',
					value: labels,
					origin: 'source',
					trusted: trusted_source,
				},
				{
					field: 'state',
					value: input.state,
					origin: 'source',
					trusted: trusted_source,
				},
				{
					field: 'kind',
					value: input.kind,
					origin: 'source',
					trusted: trusted_source,
				},
			],
			derivations,
			untrusted_content: {
				title: input.title,
				body: input.body,
				attachments: attachment_refs(input.attachments),
			},
			intake,
			requires_preview: true,
		};
	},
};

export const incident_intake_adapter: IntakeAdapter<IncidentWorkItem> =
	{
		kind: 'incident',
		adapt(input, context) {
			bounded_text(input.project, 'Incident project', 512);
			bounded_text(input.id, 'Incident id', 512);
			optional_text(input.url, 'Incident URL', 2048);
			bounded_text(input.title, 'Incident title', 32_768);
			optional_text(
				input.description,
				'Incident description',
				1_048_576,
			);
			if (!Number.isFinite(Date.parse(input.updated_at)))
				throw new Error('Incident update timestamp is invalid');
			if (
				!['triggered', 'resolved', 'cancelled', 'reopened'].includes(
					input.status,
				)
			)
				throw new Error('Incident status is invalid');
			if (
				input.severity !== undefined &&
				!['sev1', 'sev2', 'sev3', 'sev4', 'unknown'].includes(
					input.severity,
				)
			)
				throw new Error('Incident severity is invalid');
			const source: ExternalSourceIdentity = {
				kind: 'incident',
				provider: 'incident',
				project: input.project,
				id: input.id,
				url: input.url,
			};
			const trusted_source = context.trusted_source === true;
			const severity = trusted_source
				? (input.severity ?? 'unknown')
				: 'unknown';
			const risk = severity_risk[severity]!;
			const active = trusted_source && input.status === 'triggered';
			return {
				schema_version: 1,
				intake_id: randomUUID(),
				source,
				source_revision: input.updated_at,
				delivery_id:
					input.delivery_id ?? `incident:${input.updated_at}`,
				received_at: new Date().toISOString(),
				lifecycle: trusted_source
					? lifecycle_for_incident(input.status)
					: 'open',
				facts: [
					{
						field: 'severity',
						value: input.severity ?? 'unknown',
						origin: 'source',
						trusted: trusted_source,
					},
					{
						field: 'status',
						value: input.status,
						origin: 'source',
						trusted: trusted_source,
					},
				],
				derivations: trusted_source
					? [
							{
								field: 'hints.workflow',
								value: 'incident',
								confidence: 'high',
								rationale: 'Authenticated incident adapter contract',
								fact_fields: ['status'],
							},
							{
								field: 'hints.risk',
								value: risk,
								confidence: severity === 'unknown' ? 'low' : 'high',
								rationale: `Mapped incident severity ${severity}`,
								fact_fields: ['severity'],
							},
							{
								field: 'urgency',
								value: active ? 'urgent' : 'normal',
								confidence: 'high',
								rationale: 'Authenticated incident lifecycle',
								fact_fields: ['status'],
							},
						]
					: [
							{
								field: 'source_authentication',
								value: 'operator-review-required',
								confidence: 'low',
								rationale:
									'Incident severity and lifecycle were not authenticated',
								fact_fields: ['severity', 'status'],
							},
						],
				untrusted_content: {
					title: input.title,
					body: input.description,
					attachments: attachment_refs(input.attachments),
				},
				intake: {
					task: external_task(source),
					cwd: project_cwd(input.project, context),
					affected_paths: trusted_source
						? affected_path_refs(input.affected_paths)
						: undefined,
					urgency: active ? 'urgent' : 'normal',
					hints: trusted_source
						? { workflow: 'incident', risk, incident: true }
						: {},
				},
				requires_preview: true,
			};
		},
	};

export function validate_canonical_intake(
	canonical: CanonicalExternalIntake,
): void {
	if (
		!canonical ||
		typeof canonical !== 'object' ||
		canonical.schema_version !== 1 ||
		!canonical.intake_id ||
		!canonical.delivery_id ||
		!canonical.source ||
		!['github', 'incident', 'support', 'project-management'].includes(
			canonical.source.kind,
		) ||
		!canonical.source.id ||
		!canonical.source.provider ||
		!canonical.source.project ||
		!['open', 'closed', 'cancelled', 'reopened'].includes(
			canonical.lifecycle,
		) ||
		!Array.isArray(canonical.facts) ||
		!Array.isArray(canonical.derivations) ||
		!canonical.untrusted_content ||
		!canonical.intake ||
		typeof canonical.intake.task !== 'string' ||
		typeof canonical.intake.cwd !== 'string' ||
		!Number.isFinite(Date.parse(canonical.source_revision)) ||
		!Number.isFinite(Date.parse(canonical.received_at)) ||
		canonical.requires_preview !== true
	)
		throw new Error('Invalid canonical external intake');
	bounded_text(canonical.intake_id, 'Intake id', 512);
	bounded_text(canonical.delivery_id, 'Delivery id', 512);
	bounded_text(canonical.intake.task, 'Intake task', 32_768);
	bounded_text(canonical.intake.cwd, 'Intake workspace', 2048);
	bounded_text(
		canonical.untrusted_content.title,
		'External title',
		32_768,
	);
	optional_text(
		canonical.untrusted_content.body,
		'External body',
		1_048_576,
	);
	affected_path_refs(canonical.intake.affected_paths);
	attachment_refs(canonical.untrusted_content.attachments);
}
export function preview_external_intake(
	canonical: CanonicalExternalIntake,
	human_overrides: Partial<TaskIntake> = {},
): IntakePreview {
	validate_canonical_intake(canonical);
	if (human_overrides.task !== undefined)
		bounded_text(human_overrides.task, 'Overridden task', 32_768);
	affected_path_refs(human_overrides.affected_paths);
	if (
		human_overrides.urgency !== undefined &&
		!['normal', 'urgent'].includes(human_overrides.urgency)
	)
		throw new Error('Human override urgency is invalid');
	if (
		human_overrides.requested_side_effects?.some(
			(action) =>
				![
					'commit',
					'push',
					'deploy',
					'release',
					'destructive',
					'public-contract',
				].includes(action),
		)
	)
		throw new Error(
			'Human override requested side effect is invalid',
		);
	if (
		human_overrides.cwd &&
		resolve(human_overrides.cwd) !== resolve(canonical.intake.cwd)
	)
		throw new Error(
			'Human override cannot reroute intake outside the trusted project mapping',
		);
	const warnings = canonical.derivations
		.filter((item) => item.field === 'conflict')
		.map((item) => item.rationale);
	const resolved: TaskIntake = {
		...canonical.intake,
		...human_overrides,
		cwd: canonical.intake.cwd,
		hints: { ...canonical.intake.hints, ...human_overrides.hints },
		requested_side_effects: [
			...new Set([
				...(canonical.intake.requested_side_effects ?? []),
				...(human_overrides.requested_side_effects ?? []),
			]),
		],
	};
	return {
		preview_token: sha({
			intake_id: canonical.intake_id,
			delivery_id: canonical.delivery_id,
			source_revision: canonical.source_revision,
			resolved,
		}),
		canonical,
		source_facts: canonical.facts,
		derived_assumptions: canonical.derivations,
		human_overrides,
		resolved,
		warnings,
	};
}

export function preview_external_route(
	canonical: CanonicalExternalIntake,
	policy: RepositoryPolicy,
	human_overrides: Partial<TaskIntake> = {},
	route_override?: RouteOverride,
): ExternalRoutePreview {
	const preview = preview_external_intake(canonical, human_overrides);
	return {
		preview,
		route: dispatch_task(preview.resolved, policy, route_override),
	};
}

export class IntakeLedger {
	readonly path: string;
	constructor(path: string) {
		this.path = resolve(path);
	}
	private load(): IntakeLedgerFile {
		if (!existsSync(this.path))
			return { schema_version: 1, entries: {} };
		const value = JSON.parse(
			readFileSync(this.path, 'utf8'),
		) as IntakeLedgerFile;
		if (value.schema_version !== 1 || !value.entries)
			throw new Error('Unsupported intake ledger');
		return value;
	}
	private with_lock<T>(operation: () => T): T {
		mkdirSync(dirname(this.path), { recursive: true });
		const lock_path = `${this.path}.lock`;
		let lock: number;
		try {
			lock = openSync(lock_path, 'wx', 0o600);
		} catch {
			throw new Error('Intake ledger is being updated concurrently');
		}
		try {
			return operation();
		} finally {
			closeSync(lock);
			unlinkSync(lock_path);
		}
	}
	private save(value: IntakeLedgerFile): void {
		mkdirSync(dirname(this.path), { recursive: true });
		const temporary = `${this.path}.${randomUUID()}.tmp`;
		writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
			mode: 0o600,
			flag: 'wx',
		});
		renameSync(temporary, this.path);
	}
	reconcile(preview: IntakePreview): {
		entry: IntakeLedgerEntry;
		duplicate: boolean;
		stale: boolean;
	} {
		return this.with_lock(() => this.reconcile_unlocked(preview));
	}
	private reconcile_unlocked(preview: IntakePreview): {
		entry: IntakeLedgerEntry;
		duplicate: boolean;
		stale: boolean;
	} {
		const canonical = preview.canonical;
		validate_canonical_intake(canonical);
		const expected_token = sha({
			intake_id: canonical.intake_id,
			delivery_id: canonical.delivery_id,
			source_revision: canonical.source_revision,
			resolved: preview.resolved,
		});
		if (preview.preview_token !== expected_token)
			throw new Error(
				'Intake must use an unmodified reviewed preview',
			);
		const ledger = this.load();
		const key = source_key(canonical.source);
		const existing = ledger.entries[key];
		const payload_hash = sha({
			source: canonical.source,
			source_revision: canonical.source_revision,
			lifecycle: canonical.lifecycle,
			facts: canonical.facts,
			derivations: canonical.derivations,
			untrusted_content: canonical.untrusted_content,
			intake: preview.resolved,
		});
		const prior_delivery = existing?.revisions.find(
			(revision) => revision.delivery_id === canonical.delivery_id,
		);
		if (prior_delivery) {
			if (prior_delivery.payload_hash !== payload_hash)
				throw new Error(
					'External delivery id was reused with different content',
				);
			return { entry: existing!, duplicate: true, stale: false };
		}
		if (
			existing &&
			Number.isFinite(Date.parse(existing.current.source_revision)) &&
			Number.isFinite(Date.parse(canonical.source_revision)) &&
			Date.parse(canonical.source_revision) <
				Date.parse(existing.current.source_revision)
		)
			return { entry: existing, duplicate: false, stale: true };
		const action: IntakeLedgerEntry['workflow_action'] = !existing
			? canonical.lifecycle === 'open' ||
				canonical.lifecycle === 'reopened'
				? 'create'
				: 'none'
			: canonical.lifecycle === 'cancelled'
				? 'cancel'
				: canonical.lifecycle === 'closed'
					? 'pause'
					: existing.current.lifecycle === 'closed' ||
						  existing.current.lifecycle === 'cancelled'
						? 'resume'
						: 'update';
		const entry: IntakeLedgerEntry = {
			source: canonical.source,
			revisions: [
				...(existing?.revisions ?? []),
				{
					source_revision: canonical.source_revision,
					delivery_id: canonical.delivery_id,
					payload_hash,
					intake_id: canonical.intake_id,
					received_at: canonical.received_at,
					lifecycle: canonical.lifecycle,
				},
			],
			current: { ...canonical, intake: preview.resolved },
			workflow_id: existing?.workflow_id,
			workflow_action: action,
		};
		ledger.entries[key] = entry;
		this.save(ledger);
		return { entry, duplicate: false, stale: false };
	}
	bind_workflow(
		source: ExternalSourceIdentity,
		workflow_id: string,
	): void {
		this.with_lock(() =>
			this.bind_workflow_unlocked(source, workflow_id),
		);
	}
	private bind_workflow_unlocked(
		source: ExternalSourceIdentity,
		workflow_id: string,
	): void {
		const ledger = this.load();
		const entry = ledger.entries[source_key(source)];
		if (!entry)
			throw new Error(
				'Cannot bind workflow before intake reconciliation',
			);
		if (entry.workflow_id && entry.workflow_id !== workflow_id)
			throw new Error(
				'External source is already bound to another workflow',
			);
		entry.workflow_id = workflow_id;
		entry.workflow_action = 'none';
		this.save(ledger);
	}
	complete_action(
		source: ExternalSourceIdentity,
		delivery_id: string,
		action: Exclude<
			IntakeLedgerEntry['workflow_action'],
			'none' | 'create'
		>,
	): IntakeLedgerEntry {
		return this.with_lock(() => {
			const ledger = this.load();
			const entry = ledger.entries[source_key(source)];
			if (!entry) throw new Error('External intake entry is missing');
			if (
				entry.current.delivery_id === delivery_id &&
				entry.workflow_action === action
			) {
				entry.workflow_action = 'none';
				this.save(ledger);
			}
			return entry;
		});
	}
	get(source: ExternalSourceIdentity): IntakeLedgerEntry | undefined {
		return this.load().entries[source_key(source)];
	}
}

export interface IntakeLifecycleCallbacks {
	create(preview: IntakePreview): string;
	update(workflow_id: string, preview: IntakePreview): void;
	pause(workflow_id: string, reason: string): void;
	cancel(workflow_id: string, reason: string): void;
	resume(workflow_id: string, preview: IntakePreview): void;
}
export class IntakeLifecycleController {
	constructor(
		readonly ledger: IntakeLedger,
		readonly callbacks: IntakeLifecycleCallbacks,
	) {}
	process(preview: IntakePreview): {
		entry: IntakeLedgerEntry;
		duplicate: boolean;
		stale: boolean;
	} {
		const result = this.ledger.reconcile(preview);
		if (result.stale) return result;
		const action = result.entry.workflow_action;
		if (action === 'none') return result;
		if (action === 'create') {
			const workflow_id = this.callbacks.create(preview);
			this.ledger.bind_workflow(
				preview.canonical.source,
				workflow_id,
			);
			return {
				...result,
				entry: this.ledger.get(preview.canonical.source)!,
			};
		}
		const workflow_id = result.entry.workflow_id;
		if (!workflow_id)
			throw new Error('Lifecycle update requires a bound workflow');
		if (action === 'update')
			this.callbacks.update(workflow_id, preview);
		if (action === 'pause')
			this.callbacks.pause(workflow_id, 'External source closed');
		if (action === 'cancel')
			this.callbacks.cancel(workflow_id, 'External source cancelled');
		if (action === 'resume')
			this.callbacks.resume(workflow_id, preview);
		return {
			...result,
			entry: this.ledger.complete_action(
				preview.canonical.source,
				preview.canonical.delivery_id,
				action,
			),
		};
	}
}
