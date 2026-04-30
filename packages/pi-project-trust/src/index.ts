import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type ProjectTrustFallback = 'global';

export type ProjectTrustDecisionReason =
	| 'missing'
	| 'persisted'
	| 'env'
	| 'headless'
	| 'user';

export type ProjectTrustDecision =
	| {
			action: 'allow-once';
			reason: Extract<ProjectTrustDecisionReason, 'env' | 'user'>;
			metadata_trusted: false;
	  }
	| {
			action: 'trust-persisted';
			reason: Extract<
				ProjectTrustDecisionReason,
				'persisted' | 'env' | 'user'
			>;
			metadata_trusted: true;
	  }
	| {
			action: 'skip';
			reason: ProjectTrustDecisionReason;
			metadata_trusted: false;
	  }
	| {
			action: 'fallback';
			fallback: ProjectTrustFallback;
			reason: Extract<
				ProjectTrustDecisionReason,
				'env' | 'headless' | 'user'
			>;
			metadata_trusted: false;
	  };

export type ProjectTrustEnvDecision =
	| { action: 'allow-once' }
	| { action: 'trust-persisted' }
	| { action: 'skip' }
	| { action: 'fallback'; fallback: ProjectTrustFallback };

export interface ProjectTrustChoiceLabels {
	allow_once: string;
	trust: string;
	skip: string;
}

export interface ProjectTrustSubject {
	kind?: string;
	id: string;
	hash?: string;
	store_key?: string;
	env_key: string;
	prompt_title: string;
	summary_lines?: readonly string[];
	choices?: Partial<ProjectTrustChoiceLabels>;
	fallback?: ProjectTrustFallback;
	headless_warning?: string;
}

export interface ProjectTrustContext {
	has_ui?: boolean;
	select?: (message: string, choices: string[]) => Promise<string>;
	warn?: (message: string) => void;
	env?: NodeJS.ProcessEnv;
	trust_store_path?: string;
}

export interface ProjectTrustStoreEntry {
	id: string;
	hash?: string;
	kind?: string;
	trusted_at: string;
}

export type ProjectTrustStore = Record<
	string,
	ProjectTrustStoreEntry
>;

export const PROJECT_TRUST_UNTRUSTED_DEFAULTS: Record<
	string,
	string
> = {
	MY_PI_MCP_PROJECT_CONFIG: 'skip',
	MY_PI_HOOKS_CONFIG: 'skip',
	MY_PI_LSP_PROJECT_BINARY: 'global',
	MY_PI_PROMPT_PRESETS_PROJECT: 'skip',
	MY_PI_PROJECT_SKILLS: 'skip',
	MY_PI_TEAM_PROFILES_PROJECT: 'skip',
};

const ALLOW_VALUES = new Set(['1', 'true', 'yes', 'allow']);
const SKIP_VALUES = new Set(['0', 'false', 'no', 'skip', 'disable']);
const GLOBAL_FALLBACK_VALUES = new Set(['global', 'global-only']);

export function default_project_trust_store_path(): string {
	return join(
		homedir(),
		'.pi',
		'agent',
		'trusted-project-resources.json',
	);
}

export function apply_project_trust_untrusted_defaults(
	env: NodeJS.ProcessEnv = process.env,
): string[] {
	const applied: string[] = [];
	for (const [key, value] of Object.entries(
		PROJECT_TRUST_UNTRUSTED_DEFAULTS,
	)) {
		if (env[key] !== undefined) continue;
		env[key] = value;
		applied.push(key);
	}
	return applied;
}

export function normalize_project_trust_env_decision(
	value: string | undefined,
	options: { fallback?: ProjectTrustFallback } = {},
): ProjectTrustEnvDecision | undefined {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) return undefined;
	if (ALLOW_VALUES.has(normalized)) return { action: 'allow-once' };
	if (normalized === 'trust') return { action: 'trust-persisted' };
	if (SKIP_VALUES.has(normalized)) return { action: 'skip' };
	if (
		options.fallback === 'global' &&
		GLOBAL_FALLBACK_VALUES.has(normalized)
	) {
		return { action: 'fallback', fallback: 'global' };
	}
	return undefined;
}

export function read_project_trust_store(
	trust_store_path: string = default_project_trust_store_path(),
): ProjectTrustStore {
	if (!existsSync(trust_store_path)) return {};
	try {
		const raw = readFileSync(trust_store_path, 'utf-8');
		const parsed = JSON.parse(raw) as ProjectTrustStore;
		return parsed &&
			typeof parsed === 'object' &&
			!Array.isArray(parsed)
			? parsed
			: {};
	} catch {
		return {};
	}
}

export function write_project_trust_store(
	store: ProjectTrustStore,
	trust_store_path: string = default_project_trust_store_path(),
): void {
	mkdirSync(dirname(trust_store_path), { recursive: true });
	writeFileSync(
		trust_store_path,
		JSON.stringify(store, null, '\t') + '\n',
		{ encoding: 'utf8', mode: 0o600 },
	);
}

export function get_project_trust_store_key(
	subject: Pick<ProjectTrustSubject, 'id' | 'store_key'>,
): string {
	return subject.store_key ?? subject.id;
}

export function is_project_subject_trusted(
	subject: Pick<
		ProjectTrustSubject,
		'id' | 'hash' | 'kind' | 'store_key'
	>,
	trust_store_path: string = default_project_trust_store_path(),
): boolean {
	const store = read_project_trust_store(trust_store_path);
	const entry = store[get_project_trust_store_key(subject)];
	if (!entry || entry.id !== subject.id) return false;
	if (subject.kind !== undefined && entry.kind !== subject.kind) {
		return false;
	}
	return entry.hash === subject.hash;
}

export function trust_project_subject(
	subject: Pick<
		ProjectTrustSubject,
		'id' | 'hash' | 'kind' | 'store_key'
	>,
	trust_store_path: string = default_project_trust_store_path(),
	now: Date = new Date(),
): void {
	const store = read_project_trust_store(trust_store_path);
	store[get_project_trust_store_key(subject)] = {
		id: subject.id,
		...(subject.hash === undefined ? {} : { hash: subject.hash }),
		...(subject.kind === undefined ? {} : { kind: subject.kind }),
		trusted_at: now.toISOString(),
	};
	write_project_trust_store(store, trust_store_path);
}

export async function resolve_project_trust(
	subject: ProjectTrustSubject | undefined,
	context: ProjectTrustContext = {},
): Promise<ProjectTrustDecision> {
	if (!subject) {
		return {
			action: 'skip',
			reason: 'missing',
			metadata_trusted: false,
		};
	}

	const trust_store_path =
		context.trust_store_path ?? default_project_trust_store_path();
	if (is_project_subject_trusted(subject, trust_store_path)) {
		return {
			action: 'trust-persisted',
			reason: 'persisted',
			metadata_trusted: true,
		};
	}

	const env_decision = normalize_project_trust_env_decision(
		(context.env ?? process.env)[subject.env_key],
		{ fallback: subject.fallback },
	);
	const env_result = apply_normalized_decision(
		env_decision,
		'env',
		subject,
		trust_store_path,
	);
	if (env_result) return env_result;

	if (!context.has_ui || !context.select) {
		(context.warn ?? console.warn)(
			subject.headless_warning ??
				`Skipping untrusted project resource: ${subject.id}. Set ${subject.env_key}=allow to enable it for this run.`,
		);
		if (subject.fallback) {
			return {
				action: 'fallback',
				fallback: subject.fallback,
				reason: 'headless',
				metadata_trusted: false,
			};
		}
		return {
			action: 'skip',
			reason: 'headless',
			metadata_trusted: false,
		};
	}

	const labels = choice_labels(subject);
	const choices = [labels.allow_once, labels.trust, labels.skip];
	const selected = await context.select(
		format_trust_prompt(subject),
		choices,
	);
	if (selected === labels.allow_once) {
		return {
			action: 'allow-once',
			reason: 'user',
			metadata_trusted: false,
		};
	}
	if (selected === labels.trust) {
		trust_project_subject(subject, trust_store_path);
		return {
			action: 'trust-persisted',
			reason: 'user',
			metadata_trusted: true,
		};
	}
	if (subject.fallback) {
		return {
			action: 'fallback',
			fallback: subject.fallback,
			reason: 'user',
			metadata_trusted: false,
		};
	}
	return {
		action: 'skip',
		reason: 'user',
		metadata_trusted: false,
	};
}

function apply_normalized_decision(
	decision: ProjectTrustEnvDecision | undefined,
	reason: 'env',
	subject: ProjectTrustSubject,
	trust_store_path: string,
): ProjectTrustDecision | undefined {
	if (!decision) return undefined;
	if (decision.action === 'trust-persisted') {
		trust_project_subject(subject, trust_store_path);
		return {
			action: 'trust-persisted',
			reason,
			metadata_trusted: true,
		};
	}
	if (decision.action === 'allow-once') {
		return {
			action: 'allow-once',
			reason,
			metadata_trusted: false,
		};
	}
	if (decision.action === 'fallback') {
		return {
			action: 'fallback',
			fallback: decision.fallback,
			reason,
			metadata_trusted: false,
		};
	}
	return { action: 'skip', reason, metadata_trusted: false };
}

function choice_labels(
	subject: ProjectTrustSubject,
): ProjectTrustChoiceLabels {
	return {
		allow_once:
			subject.choices?.allow_once ?? 'Allow once for this session',
		trust: subject.choices?.trust ?? 'Trust this resource',
		skip:
			subject.choices?.skip ??
			(subject.fallback === 'global'
				? 'Use global fallback instead'
				: 'Skip project resource'),
	};
}

function format_trust_prompt(subject: ProjectTrustSubject): string {
	return [
		subject.prompt_title,
		`ID: ${subject.id}`,
		...(subject.hash ? [`SHA-256: ${subject.hash}`] : []),
		...(subject.summary_lines ?? []),
	].join('\n');
}
