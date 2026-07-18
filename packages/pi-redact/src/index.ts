// Filter-output extension — redact secrets from tool output
// Patterns from https://github.com/spences10/nopeek

import type {
	ImageContent,
	TextContent,
} from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { resolve } from 'node:path';

interface SecretPattern {
	name: string;
	pattern: RegExp;
}

interface RedactionResult {
	redacted: string;
	count: number;
}

interface RedactionOptions {
	force_ssh_config?: boolean;
	force_private_key?: boolean;
}

const PRIVATE_KEY_BEGIN_PATTERN =
	/-----BEGIN[ \t]+[\w -]*PRIVATE[ \t]+KEY-----/;
const PRIVATE_KEY_END_PATTERN =
	/-----END[ \t]+[\w -]*PRIVATE[ \t]+KEY-----/;

const SECRET_PATTERNS: SecretPattern[] = [
	{ name: 'AWS Access Key', pattern: /AKIA[A-Z0-9]{16}/g },
	{ name: 'AWS Temp Access Key', pattern: /ASIA[A-Z0-9]{16}/g },
	{
		name: 'AWS Secret Key',
		pattern:
			/\b(?:AWS_SECRET_ACCESS_KEY|aws_secret_access_key|secret_access_key|SecretAccessKey)\b\s*[:=]\s*["']?[A-Za-z0-9/+=]{40,}["']?/g,
	},
	{
		name: 'Bearer Token',
		pattern: /Bearer\s+[a-zA-Z0-9._-]{20,}/g,
	},
	{
		name: 'OpenAI/Anthropic API Key',
		pattern: /sk-[a-zA-Z0-9._-]{20,}/g,
	},
	{
		name: 'Stripe Live Key',
		pattern: /sk_live_[a-zA-Z0-9]{20,}/g,
	},
	{
		name: 'Stripe Test Key',
		pattern: /sk_test_[a-zA-Z0-9]{20,}/g,
	},
	{
		name: 'Hetzner Token',
		pattern:
			/(?:HCLOUD_TOKEN|hcloud_token|token)\s*[:=]\s*["']?[a-f0-9]{64}\b/g,
	},
	{
		name: 'Private Key',
		pattern:
			/-----BEGIN[ \t]+[\w -]*PRIVATE[ \t]+KEY-----[\s\S]*?(?:-----END[ \t]+[\w -]*PRIVATE[ \t]+KEY-----|$)/g,
	},
	{
		name: 'Connection String with Password',
		pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^:\s/?#]+:[^@\s/?#]+@/gi,
	},
	{
		name: 'Generic Secret Phrase',
		pattern:
			/\b(?:password|passwd|secret|token|api[_-]?key)\b\s+(?:is|was|seen|value|header)\s+["']?[A-Za-z0-9._:/+=@!-]{12,}["']?/gi,
	},
	{
		name: 'Tavily API Key',
		pattern: /tvly-[a-zA-Z0-9_-]{20,}/g,
	},
	{
		name: 'Kagi API Key',
		pattern: /[a-zA-Z0-9_-]{40,}\.[a-zA-Z0-9_-]{40,}/g,
	},
	{
		name: 'Brave API Key',
		pattern: /BSA[A-Z0-9]{20,}/g,
	},
	{
		name: 'Firecrawl API Key',
		pattern: /fc-[a-f0-9]{32}/g,
	},
	{
		name: 'GitHub Token',
		pattern: /gh[pousr]_[a-zA-Z0-9]{36,}/g,
	},
	{
		name: 'GitHub Fine-grained PAT',
		pattern: /github_pat_[a-zA-Z0-9_]{20,}/g,
	},
	{
		name: 'JWT',
		pattern:
			/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
	},
	{
		name: 'Slack Token',
		pattern: /xox[baprs]-[A-Za-z0-9-]{20,}/g,
	},
	{
		name: 'GitLab Token',
		pattern: /glpat-[A-Za-z0-9_-]{20,}/g,
	},
	{
		name: 'Google API Key',
		pattern: /AIza[A-Za-z0-9_-]{35}/g,
	},
	{
		name: 'npm Token',
		pattern: /npm_[A-Za-z0-9]{36,}/g,
	},
	{
		name: 'SendGrid API Key',
		pattern: /SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{32,}/g,
	},
];

const SECRET_FIELD_NAME =
	'(?:[A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY)|password|passwd|secret|token|api[_-]?key|access[_-]?token|client[_-]?secret|private[_-]?key)';
const JSON_SECRET_FIELD_NAME =
	'[A-Za-z0-9_-]*(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)';
const DOUBLE_QUOTED_JSON_SECRET_FIELD_PATTERN = new RegExp(
	`(^|[^A-Za-z0-9_])((?:"${JSON_SECRET_FIELD_NAME}")[ \\t]*:[ \\t]*")((?:\\\\.|[^"\\\\]){8,})"`,
	'gim',
);
const SINGLE_QUOTED_JSON_SECRET_FIELD_PATTERN = new RegExp(
	`(^|[^A-Za-z0-9_])((?:'${JSON_SECRET_FIELD_NAME}')[ \\t]*:[ \\t]*')((?:\\\\.|[^'\\\\]){8,})'`,
	'gim',
);
const DOUBLE_QUOTED_SECRET_FIELD_PATTERN = new RegExp(
	`(^|[^A-Za-z0-9_])((?:"?${SECRET_FIELD_NAME}"?)[ \\t]*[:=][ \\t]*")((?:\\\\.|[^"\\\\]){8,})"`,
	'gm',
);
const SINGLE_QUOTED_SECRET_FIELD_PATTERN = new RegExp(
	`(^|[^A-Za-z0-9_])((?:'?${SECRET_FIELD_NAME}'?)[ \\t]*[:=][ \\t]*')((?:\\\\.|[^'\\\\]){8,})'`,
	'gm',
);
const UNQUOTED_SECRET_FIELD_PATTERN = new RegExp(
	`(^|[^A-Za-z0-9_])((?:${SECRET_FIELD_NAME})[ \\t]*[:=][ \\t]*)([^\\s"',;}\\]]{8,})`,
	'gm',
);

const SSH_CONFIG_VALUE_DIRECTIVE_PATTERN =
	/^([ \t]*)(HostName|User|IdentityFile|CertificateFile|ProxyJump|ProxyCommand|LocalForward|RemoteForward|DynamicForward|HostKeyAlias)(\s+)(.+)$/gim;
const SSH_CONFIG_HOST_PATTERN = /^([ \t]*)(Host)(\s+)(.+)$/gim;
const SSH_CONFIG_MATCH_PATTERN = /^([ \t]*)(Match)(\s+)(.+)$/gim;

export function looks_like_ssh_config(text: string): boolean {
	const has_scope_line = /^\s*(?:Host|Match)\b/m.test(text);
	const has_sensitive_directive =
		/^\s*(?:HostName|User|IdentityFile|CertificateFile|ProxyJump|ProxyCommand|LocalForward|RemoteForward|DynamicForward|HostKeyAlias)\b/im.test(
			text,
		);

	return has_scope_line && has_sensitive_directive;
}

export function redact_ssh_config_metadata(
	text: string,
): RedactionResult {
	let count = 0;

	const redact_directive_value = (
		match: string,
		indent: string,
		directive: string,
		spacing: string,
		value: string,
	): string => {
		if (value.includes('[REDACTED:')) return match;
		count++;
		return `${indent}${directive}${spacing}[REDACTED:SSH ${directive}]`;
	};

	let result = text.replace(
		SSH_CONFIG_VALUE_DIRECTIVE_PATTERN,
		redact_directive_value,
	);

	result = result.replace(
		SSH_CONFIG_HOST_PATTERN,
		(
			match: string,
			indent: string,
			directive: string,
			spacing: string,
			value: string,
		) => {
			const trimmed = value.trim();
			if (trimmed === '*' || value.includes('[REDACTED:'))
				return match;
			count++;
			return `${indent}${directive}${spacing}[REDACTED:SSH Host]`;
		},
	);

	result = result.replace(
		SSH_CONFIG_MATCH_PATTERN,
		(
			match: string,
			indent: string,
			directive: string,
			spacing: string,
			value: string,
		) => {
			if (value.trim().toLowerCase() === 'all') return match;
			if (value.includes('[REDACTED:')) return match;
			count++;
			return `${indent}${directive}${spacing}[REDACTED:SSH Match]`;
		},
	);

	return { redacted: result, count };
}

function redact_secret_fields(text: string): RedactionResult {
	let count = 0;
	let result = text;
	const marker = '[REDACTED:Generic Password Field]';

	const redact_quoted = (pattern: RegExp, quote: '"' | "'"): void => {
		pattern.lastIndex = 0;
		result = result.replace(
			pattern,
			(
				match,
				boundary: string,
				assignment: string,
				value: string,
			) => {
				if (value.includes('[REDACTED:')) return match;
				count += 1;
				return `${boundary}${assignment}${marker}${quote}`;
			},
		);
	};

	redact_quoted(DOUBLE_QUOTED_JSON_SECRET_FIELD_PATTERN, '"');
	redact_quoted(SINGLE_QUOTED_JSON_SECRET_FIELD_PATTERN, "'");
	redact_quoted(DOUBLE_QUOTED_SECRET_FIELD_PATTERN, '"');
	redact_quoted(SINGLE_QUOTED_SECRET_FIELD_PATTERN, "'");
	UNQUOTED_SECRET_FIELD_PATTERN.lastIndex = 0;
	result = result.replace(
		UNQUOTED_SECRET_FIELD_PATTERN,
		(match, boundary: string, assignment: string, value: string) => {
			if (value.includes('[REDACTED:')) return match;
			count += 1;
			return `${boundary}${assignment}${marker}`;
		},
	);

	return { redacted: result, count };
}

function redact_secret_patterns(text: string): RedactionResult {
	let count = 0;
	let result = text;

	for (const sp of SECRET_PATTERNS) {
		sp.pattern.lastIndex = 0;
		result = result.replace(sp.pattern, (match) => {
			count++;
			const prefix = match.slice(0, 4);
			return `${prefix}${'*'.repeat(Math.min(match.length - 4, 20))}[REDACTED:${sp.name}]`;
		});
	}

	return { redacted: result, count };
}

function is_ssh_config_path(path: unknown): boolean {
	if (typeof path !== 'string') return false;
	const normalized = path.replaceAll('\\', '/').toLowerCase();
	return /(?:^|\/)(?:\.ssh\/(?:config|config\.d\/.+|conf\.d\/.+)|ssh_config)$/.test(
		normalized,
	);
}

function should_force_ssh_config_redaction(event: {
	toolName?: string;
	input?: unknown;
}): boolean {
	if (event.toolName !== 'read') return false;
	if (!event.input || typeof event.input !== 'object') return false;
	return is_ssh_config_path((event.input as { path?: unknown }).path);
}

function is_text_content(
	item: TextContent | ImageContent,
): item is TextContent {
	return item.type === 'text';
}

export function redact_text(
	text: string,
	options?: RedactionOptions,
): RedactionResult {
	if (options?.force_private_key && text) {
		return {
			redacted: '[REDACTED:Private Key continuation]',
			count: 1,
		};
	}

	let count = 0;
	let result = text;

	if (options?.force_ssh_config || looks_like_ssh_config(result)) {
		const ssh_redaction = redact_ssh_config_metadata(result);
		result = ssh_redaction.redacted;
		count += ssh_redaction.count;
	}

	const field_redaction = redact_secret_fields(result);
	result = field_redaction.redacted;
	count += field_redaction.count;

	const secret_redaction = redact_secret_patterns(result);
	result = secret_redaction.redacted;
	count += secret_redaction.count;

	return { redacted: result, count };
}

export default async function filter_output(pi: ExtensionAPI) {
	let total_redacted = 0;
	const partial_private_key_paths = new Set<string>();

	pi.on('tool_result', async (event) => {
		if (!event.content) return;

		const force_ssh_config = should_force_ssh_config_redaction(event);
		const input_path =
			event.toolName === 'read' &&
			event.input &&
			typeof event.input === 'object' &&
			typeof (event.input as { path?: unknown }).path === 'string'
				? (event.input as { path: string }).path
				: undefined;
		const normalized_input_path = input_path
			? resolve(input_path)
			: undefined;
		let private_key_continuation = Boolean(
			normalized_input_path &&
			partial_private_key_paths.has(normalized_input_path),
		);
		let modified = false;

		const new_content = event.content.map((item) => {
			if (!is_text_content(item) || !item.text) return item;
			const { redacted, count } = redact_text(item.text, {
				force_ssh_config,
				force_private_key: private_key_continuation,
			});
			if (count > 0) {
				modified = true;
				total_redacted += count;
			}

			const has_private_key_begin = PRIVATE_KEY_BEGIN_PATTERN.test(
				item.text,
			);
			const has_private_key_end = PRIVATE_KEY_END_PATTERN.test(
				item.text,
			);
			if (private_key_continuation && has_private_key_end) {
				private_key_continuation = false;
			}
			if (has_private_key_begin) {
				private_key_continuation = !has_private_key_end;
			}

			return { ...item, text: redacted } satisfies TextContent;
		});

		if (normalized_input_path) {
			if (private_key_continuation) {
				partial_private_key_paths.add(normalized_input_path);
			} else {
				partial_private_key_paths.delete(normalized_input_path);
			}
		}

		if (modified) return { content: new_content };
	});

	pi.registerCommand('redact-stats', {
		description: 'Show how many secrets have been redacted',
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				`Secrets redacted this session: ${total_redacted}`,
			);
		},
	});
}
