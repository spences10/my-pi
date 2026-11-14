import { Buffer } from 'node:buffer';

export interface RedactionResult {
	redacted: string;
	count: number;
}

export interface RedactionOptions {
	force_ssh_config?: boolean;
	force_private_key?: boolean;
	known_values?: readonly string[];
}

interface SecretPattern {
	name: string;
	pattern: RegExp;
	value_group?: number;
}

/** UTF-16 offsets into the original text, with an exclusive end. */
export interface RedactionSpan {
	start: number;
	end: number;
	label: string;
}

// Boundaries prevent restarting a failed variable-length match inside the
// same token (notably JWT and URI schemes). No secret prefix is kept.
const secret_patterns: SecretPattern[] = [
	{
		name: 'AWS Access Key',
		pattern: /(?<!\w)AKIA[A-Z0-9]{16}(?!\w)/g,
	},
	{
		name: 'AWS Temp Access Key',
		pattern: /(?<!\w)ASIA[A-Z0-9]{16}(?!\w)/g,
	},
	{
		name: 'Bearer Token',
		pattern: /\bBearer[ \t]+([A-Za-z0-9._~+/-]{20,}={0,2})/dgi,
		value_group: 1,
	},
	{
		name: 'OpenAI/Anthropic API Key',
		pattern: /(?<!\w)sk-[A-Za-z0-9._-]{20,}/g,
	},
	{
		name: 'Stripe Live Key',
		pattern: /(?<!\w)sk_live_[A-Za-z0-9]{20,}/g,
	},
	{
		name: 'Stripe Test Key',
		pattern: /(?<!\w)sk_test_[A-Za-z0-9]{20,}/g,
	},
	{
		name: 'Stripe Restricted Key',
		pattern: /(?<!\w)rk_(?:live|test)_[A-Za-z0-9]{20,}/g,
	},
	{
		name: 'Stripe Webhook Secret',
		pattern: /(?<!\w)whsec_[A-Za-z0-9]{20,}/g,
	},
	{
		name: 'Tavily API Key',
		pattern: /(?<!\w)tvly-[A-Za-z0-9_-]{20,}/g,
	},
	{ name: 'Brave API Key', pattern: /(?<!\w)BSA[A-Z0-9]{20,}/g },
	{
		name: 'Firecrawl API Key',
		pattern: /(?<!\w)fc-[a-f0-9]{32}(?![a-f0-9])/g,
	},
	{
		name: 'GitHub Token',
		pattern: /(?<!\w)gh[pousr]_[A-Za-z0-9]{36,}/g,
	},
	{
		name: 'GitHub Fine-grained PAT',
		pattern: /(?<!\w)github_pat_[A-Za-z0-9_]{20,}/g,
	},
	{
		name: 'JWT',
		pattern:
			/(?<![\w.-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?![\w.-])/g,
	},
	{
		name: 'Slack Token',
		pattern: /(?<!\w)xox[baprs]-[A-Za-z0-9-]{20,}/g,
	},
	{
		name: 'GitLab Token',
		pattern: /(?<!\w)glpat-[A-Za-z0-9_-]{20,}/g,
	},
	{
		name: 'Google API Key',
		pattern: /(?<!\w)AIza[A-Za-z0-9_-]{35}(?![\w-])/g,
	},
	{ name: 'npm Token', pattern: /(?<!\w)npm_[A-Za-z0-9]{36,}/g },
	{
		name: 'SendGrid API Key',
		pattern: /(?<!\w)SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{32,}/g,
	},
	{
		name: 'Hugging Face Token',
		pattern: /(?<!\w)hf_[A-Za-z0-9]{30,}/g,
	},
	{
		name: 'Groq API Key',
		pattern: /(?<!\w)gsk_[A-Za-z0-9]{20,}/g,
	},
	{
		name: 'xAI API Key',
		pattern: /(?<!\w)xai-[A-Za-z0-9_-]{20,}/g,
	},
	{
		name: 'DigitalOcean Token',
		pattern: /(?<!\w)dop_v1_[a-f0-9]{64}(?![a-f0-9])/g,
	},
	{
		name: 'Supabase Token',
		pattern: /(?<!\w)sbp_[a-f0-9]{40}(?![a-f0-9])/g,
	},
	{
		name: 'Connection String with Password',
		pattern:
			/(?<![A-Za-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/[^:\s/?#@]*:[^@\s/?#]+@/gi,
	},
	{
		name: 'Generic Secret Phrase',
		pattern:
			/\b(?:password|passwd|secret|token|api[_-]?key)[ \t]+(?:is|was|seen|value|header)[ \t]+["']?([A-Za-z0-9._:/+=@!-]{12,})["']?/dgi,
		value_group: 1,
	},
];

const marker_labels = [
	...secret_patterns.map(({ name }) => name),
	'Known Secret',
	'Private Key',
	'Private Key continuation',
	'Generic Password Field',
	'AWS Secret Key',
	'Kagi API Key',
	'Authorization Credential',
	'Secret Field',
	'Secret-bearing line',
];

const ssh_marker_labels =
	'Host|Match|HostName|User|IdentityFile|CertificateFile|ProxyJump|ProxyCommand|LocalForward|RemoteForward|DynamicForward|HostKeyAlias'.replace(
		/[A-Za-z]/g,
		(letter) => `[${letter.toUpperCase()}${letter.toLowerCase()}]`,
	);

const marker_pattern = new RegExp(
	`\\[REDACTED:(?:${marker_labels.map(escape_regexp).join('|')}|SSH (?:${ssh_marker_labels}))\\]`,
	'g',
);

const whole_marker_pattern = new RegExp(`^${marker_pattern.source}$`);

export function is_redaction_marker(value: string): boolean {
	return whole_marker_pattern.test(value);
}

const pem_begin = /^-----BEGIN (?:[A-Z0-9-]+ )*PRIVATE KEY-----$/;
const pem_end = /^-----END (?:[A-Z0-9-]+ )*PRIVATE KEY-----/;
const pem_body = /^[A-Za-z0-9+/]{16,}={0,2}$/;
const pem_short_body = /^[A-Za-z0-9+/]+={0,2}$/;

const pem_metadata =
	/^(?:Proc-Type: 4,ENCRYPTED|DEK-Info: [A-Z0-9-]+,[A-Fa-f0-9]+)$/;

const ssh_directive =
	/^([ \t]*)(Host|Match|HostName|User|IdentityFile|CertificateFile|ProxyJump|ProxyCommand|LocalForward|RemoteForward|DynamicForward|HostKeyAlias)([ \t]+)([^\r\n]+)$/gim;

export function looks_like_ssh_config(text: string): boolean {
	return (
		/^[ \t]*(?:Host|Match)[ \t]+\S/im.test(text) &&
		/^[ \t]*(?:HostName|User|IdentityFile|CertificateFile|ProxyJump|ProxyCommand|LocalForward|RemoteForward|DynamicForward|HostKeyAlias)[ \t]+\S/im.test(
			text,
		)
	);
}

function find_ssh_config_spans(text: string): RedactionSpan[] {
	const spans: RedactionSpan[] = [];

	for (const match of text.matchAll(ssh_directive)) {
		const [, indent, directive, spacing, value] = match;

		if (is_redaction_marker(value.trim())) continue;

		if (directive.toLowerCase() === 'host' && value.trim() === '*')
			continue;

		if (
			directive.toLowerCase() === 'match' &&
			value.trim().toLowerCase() === 'all'
		)
			continue;

		const start =
			match.index + indent.length + directive.length + spacing.length;

		spans.push({
			start,
			end: start + value.length,
			label: `SSH ${directive}`,
		});
	}

	return spans;
}

export function redact_ssh_config_metadata(
	text: string,
): RedactionResult {
	return render_redaction_spans(text, find_ssh_config_spans(text));
}

function escape_regexp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Shared representations for exact masking and streaming prefix checks. */
export function known_value_forms(
	values: readonly string[],
): string[] {
	const forms = new Set<string>();

	for (const value of values) {
		if (!value) continue;
		forms.add(value);
		forms.add(JSON.stringify(value).slice(1, -1));
		forms.add(Buffer.from(value).toString('base64'));
		forms.add(Buffer.from(value).toString('base64url'));

		try {
			const encoded = encodeURIComponent(value);
			forms.add(encoded);
			forms.add(
				encoded.replace(/%[A-F0-9]{2}/g, (part) =>
					part.toLowerCase(),
				),
			);
		} catch {
			// Lone surrogates have no URI encoding; raw and JSON forms still match.
		}
	}

	return [...forms].sort((left, right) => right.length - left.length);
}

function find_known_value_spans(
	text: string,
	values: readonly string[],
): RedactionSpan[] {
	const forms = known_value_forms(values);

	if (!forms.length) return [];
	const pattern = new RegExp(forms.map(escape_regexp).join('|'), 'g');

	const markers = [...text.matchAll(marker_pattern)].map((match) => ({
		start: match.index,
		end: match.index + match[0].length,
	}));

	const spans: RedactionSpan[] = [];
	let marker_index = 0;

	for (
		let match = pattern.exec(text);
		match;
		match = pattern.exec(text)
	) {
		const start = match.index;
		const end = start + match[0].length;
		// Include overlapping registered matches, not only disjoint regex matches.
		pattern.lastIndex = start + 1;

		while (
			marker_index < markers.length &&
			markers[marker_index].end <= start
		)
			marker_index++;
		const first_marker = markers[marker_index];

		if (
			first_marker &&
			first_marker.start <= start &&
			end <= first_marker.end
		)
			continue;

		const span = { start, end, label: 'Known Secret' };

		// A match crossing a generated marker must also consume that marker,
		// rather than leaving a broken prefix that changes on the next pass.
		for (
			let index = marker_index;
			index < markers.length && markers[index].start < end;
			index++
		) {
			span.start = Math.min(span.start, markers[index].start);
			span.end = Math.max(span.end, markers[index].end);
		}

		spans.push(span);
	}

	return spans;
}

/** A line category is not proof of a key: a header still needs body/END evidence. */
export function classify_private_key_line(
	line: string,
):
	| 'header'
	| 'body'
	| 'short_body'
	| 'end'
	| 'metadata'
	| 'blank'
	| 'other' {
	const trimmed = line.trim();
	// Only the last BEGIN on a line can precede the following body. A
	// literal search avoids retrying the PEM-label regex at every BEGIN.
	const header_start = line.lastIndexOf('-----BEGIN ');

	if (
		header_start >= 0 &&
		pem_begin.test(line.slice(header_start).trimEnd())
	)
		return 'header';

	if (pem_end.test(trimmed)) return 'end';

	if (pem_body.test(trimmed)) return 'body';

	if (pem_short_body.test(trimmed)) return 'short_body';

	if (pem_metadata.test(trimmed)) return 'metadata';

	if (!trimmed) return 'blank';

	return 'other';
}

function find_private_key_spans(
	text: string,
	force: boolean,
): RedactionSpan[] {
	const lines = text.split('\n');
	let offset = 0;

	const line_offsets = lines.map((line) => {
		const start = offset;
		offset += line.length + 1;

		return start;
	});

	const spans: RedactionSpan[] = [];

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const trimmed = line.trim();
		const kind = classify_private_key_line(line);
		const header = kind === 'header';

		const continuation =
			force &&
			(kind === 'body' ||
				kind === 'end' ||
				(kind === 'short_body' &&
					classify_private_key_line(lines[index + 1] ?? '') ===
						'end'));

		if (!header && !continuation) continue;

		let end = index + 1;
		let has_body = continuation;
		let footer = pem_end.exec(trimmed);

		while (!footer && end < lines.length) {
			const next = lines[end].trim();
			const next_kind = classify_private_key_line(next);
			footer = pem_end.exec(next);

			if (footer) {
				end++;
				break;
			}

			if (
				next_kind === 'body' ||
				(next_kind === 'short_body' &&
					((has_body && next.endsWith('=')) ||
						classify_private_key_line(lines[end + 1] ?? '') ===
							'end'))
			) {
				has_body = true;
				end++;
				continue;
			}

			if (next_kind === 'blank' || next_kind === 'metadata') {
				end++;
				continue;
			}

			break;
		}

		if (!has_body && !footer) continue;

		while (end > index + 1 && !lines[end - 1].trim()) end--;
		const last_line = lines[end - 1];
		let end_offset = line_offsets[end - 1] + last_line.length;

		if (footer) {
			end_offset =
				line_offsets[end - 1] +
				last_line.length -
				last_line.trimStart().length +
				footer[0].length;
		} else if (last_line.endsWith('\r')) {
			end_offset--;
		}

		const start =
			line_offsets[index] +
			(header ? line.lastIndexOf('-----BEGIN ') : 0);

		spans.push({
			start,
			end: end_offset,
			label: header ? 'Private Key' : 'Private Key continuation',
		});
		index = end - 1;
	}

	return spans;
}

function is_sensitive_field(name: string): boolean {
	return /(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)$/i.test(
		name,
	);
}

function is_kagi_key(name: string, value: string): boolean {
	return (
		/^kagi_api_key$/i.test(name) &&
		/^[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{40,}$/.test(value)
	);
}

function is_placeholder(value: string): boolean {
	return (
		is_redaction_marker(value) ||
		/^\$\{|^\$\([\s\S]*\)$|^\$[A-Za-z_][A-Za-z0-9_]*$/.test(value)
	);
}

function is_literal_field_value(
	name: string,
	value: string,
	separator: string,
): boolean {
	if (
		/^["'`{]/.test(value) ||
		/^\[["']/.test(value) ||
		is_placeholder(value)
	)
		return false;

	if (
		!is_kagi_key(name, value) &&
		/^[A-Za-z_$][\w$]*(?:(?:\.[A-Za-z_$][\w$]*)|(?:\[[^\]]*\])|(?:\([^)]*\)))+(?:;)?$/.test(
			value,
		)
	)
		return false;

	if (
		separator.includes(':') &&
		/^(?:(?:string|number|boolean|unknown|undefined|never|any|Record<.*>|Promise<.*>)(?:\[\])?;?|[A-Z][\w$]*(?:\[\])?;)$/.test(
			value,
		)
	)
		return false;

	return true;
}

function find_secret_field_spans(text: string): RedactionSpan[] {
	const spans: RedactionSpan[] = [];

	const add_field = (
		name: string,
		value: string,
		start: number,
	): void => {
		if (
			!is_sensitive_field(name) ||
			value.length < 8 ||
			is_placeholder(value)
		)
			return;
		let label = 'Generic Password Field';

		if (/^(?:aws_)?secret_access_key$|^SecretAccessKey$/i.test(name))
			label = 'AWS Secret Key';

		if (is_kagi_key(name, value)) label = 'Kagi API Key';
		spans.push({ start, end: start + value.length, label });
	};

	// A quoted value cannot cross a physical line, even with a backslash.
	const quoted =
		/(^[ \t]*(?:export[ \t]+)?|[{,][ \t]*)(["']?)([A-Za-z_][A-Za-z0-9_-]*)\2([ \t]*[:=][ \t]*)("(?:\\[^\r\n]|[^"\\\r\n])*"|'(?:\\[^\r\n]|[^'\\\r\n])*')/gm;

	for (const match of text.matchAll(quoted)) {
		const name = match[3];
		const value = match[5];
		add_field(
			name,
			value.slice(1, -1),
			match.index + match[0].length - value.length + 1,
		);
	}

	// Unquoted values must be standalone config assignments, not expressions
	// after `const`, function parameters, object schemas, or prose fragments.
	const unquoted =
		/^([ \t]*(?:export[ \t]+)?)([A-Za-z_][A-Za-z0-9_-]*)([ \t]*[:=][ \t]*)([^\r\n]+)$/gm;

	for (const match of text.matchAll(unquoted)) {
		const [, prefix, name, separator, remainder] = match;

		const marker_prefix =
			/^\[REDACTED:[^[\]\r\n]+\]/.exec(remainder)?.[0] ?? '';

		const token_tail =
			/^\S*/.exec(remainder.slice(marker_prefix.length))?.[0] ?? '';

		const value = marker_prefix + token_tail;
		const trailing = remainder.slice(value.length);

		if (!/^(?:[ \t]+#.*|[ \t]*)$/.test(trailing)) continue;

		if (!is_literal_field_value(name, value, separator)) continue;
		add_field(
			name,
			value,
			match.index + prefix.length + name.length + separator.length,
		);
	}

	// Diagnostic prefixes may precede key=value fields. Keep this separate
	// from colon/property matching so inline source types stay untouched.
	const inline_assignment =
		/(^|[ \t])([A-Za-z_][A-Za-z0-9_-]*)([ \t]*=[ \t]*)/g;

	let line_offset = 0;

	for (const line of text.split('\n')) {
		const line_start = line_offset;
		line_offset += line.length + 1;

		if (
			/^[ \t]*(?:(?:export|declare)[ \t]+)*(?:const|let|var|function|class|interface|type|import|return)\b|^[ \t]*[A-Za-z_$][\w$.]*[ \t]*\(/.test(
				line,
			)
		)
			continue;
		const content_start = line.length - line.trimStart().length;

		for (const match of line.matchAll(inline_assignment)) {
			const [, prefix, name] = match;

			if (
				match.index + prefix.length <= content_start ||
				!is_sensitive_field(name)
			)
				continue;
			const start = match.index + match[0].length;
			const remainder = line.slice(start);

			const literal =
				/^("(?:\\[^\r\n]|[^"\\\r\n])*"|'(?:\\[^\r\n]|[^'\\\r\n])*')/.exec(
					remainder,
				)?.[0];

			if (literal !== undefined) {
				add_field(name, literal.slice(1, -1), line_start + start + 1);
				continue;
			}

			const marker_prefix =
				/^\[REDACTED:[^[\]\r\n]+\]/.exec(remainder)?.[0] ?? '';

			const tail =
				/^(?:\\[^\r\n]|[^\s"'\\])*/.exec(
					remainder.slice(marker_prefix.length),
				)?.[0] ?? '';

			const value = marker_prefix + tail;

			if (is_literal_field_value(name, value, '='))
				add_field(name, value, line_start + start);
		}
	}

	return spans;
}

export function merge_redaction_spans(
	spans: readonly RedactionSpan[],
): RedactionSpan[] {
	const sorted = [...spans].sort(
		(left, right) => left.start - right.start || right.end - left.end,
	);

	const merged: RedactionSpan[] = [];

	for (const span of sorted) {
		const previous = merged.at(-1);

		if (previous && span.start < previous.end) {
			previous.end = Math.max(previous.end, span.end);
		} else {
			merged.push({ ...span });
		}
	}

	return merged;
}

function render_redaction_spans(
	text: string,
	spans: readonly RedactionSpan[],
): RedactionResult {
	const parts: string[] = [];
	let start = 0;

	for (const span of spans) {
		parts.push(
			text.slice(start, span.start),
			`[REDACTED:${span.label}]`,
		);
		start = span.end;
	}

	parts.push(text.slice(start));

	return { redacted: parts.join(''), count: spans.length };
}

/** Detect every supported shape on the original text, then union overlaps. */
export function find_redaction_spans(
	text: string,
	options: RedactionOptions = {},
): RedactionSpan[] {
	const spans = find_known_value_spans(
		text,
		options.known_values ?? [],
	);

	for (const span of find_private_key_spans(
		text,
		options.force_private_key ?? false,
	))
		spans.push(span);

	if (options.force_ssh_config || looks_like_ssh_config(text)) {
		for (const span of find_ssh_config_spans(text)) spans.push(span);
	}

	for (const span of find_secret_field_spans(text)) spans.push(span);

	const authorization =
		/\b((?:Proxy-)?Authorization["']?[ \t]*:[ \t]*["']?)(Basic|Bearer|Token|ApiKey)([ \t]+)((?:\[REDACTED:[^[\]\r\n]+\]|\\[^\r\n]|[^\s"'`\\])+)/gi;

	for (const match of text.matchAll(authorization)) {
		const [, prefix, scheme, spacing, value] = match;

		if (is_placeholder(value)) continue;

		const start =
			match.index + prefix.length + scheme.length + spacing.length;

		spans.push({
			start,
			end: start + value.length,
			label:
				scheme.toLowerCase() === 'bearer'
					? 'Bearer Token'
					: 'Authorization Credential',
		});
	}

	for (const { name, pattern, value_group } of secret_patterns) {
		for (const match of text.matchAll(pattern)) {
			const range = match.indices?.[value_group ?? 0] ?? [
				match.index,
				match.index + match[0].length,
			];

			spans.push({ start: range[0], end: range[1], label: name });
		}
	}

	return merge_redaction_spans(spans);
}

export function redact_text(
	text: string,
	options: RedactionOptions = {},
): RedactionResult {
	return render_redaction_spans(
		text,
		find_redaction_spans(text, options),
	);
}
