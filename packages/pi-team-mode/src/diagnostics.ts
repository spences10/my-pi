const DEFAULT_DIAGNOSTIC_MAX_BYTES = 64 * 1024;
const REDACTED = '[REDACTED]';

export interface SafeDiagnosticStream {
	text: string;
	bytes: number;
	stored_bytes: number;
	truncated: boolean;
	redaction_count: number;
}

export interface SafeProcessDiagnostics {
	command?: string;
	exit_code: number | null;
	signal?: NodeJS.Signals | null;
	timed_out: boolean;
	stdout: SafeDiagnosticStream;
	stderr: SafeDiagnosticStream;
}

export interface ProcessDiagnosticsInput {
	command?: string;
	exit_code: number | null;
	signal?: NodeJS.Signals | null;
	timed_out?: boolean;
	stdout?: string;
	stderr?: string;
}

function redact_diagnostic_text(value: string): {
	text: string;
	count: number;
} {
	let text = value;
	let count = 0;
	const replace = (
		pattern: RegExp,
		replacer: string | ((...args: string[]) => string),
	) => {
		text = text.replace(pattern, (...args) => {
			count += 1;
			return typeof replacer === 'string'
				? replacer
				: replacer(...(args as string[]));
		});
	};

	replace(
		/\b(authorization)\s*:\s*(?:bearer|basic)\s+[^\s,;]+/gi,
		(_match, name) => `${name}: ${REDACTED}`,
	);
	replace(
		/\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE[_-]?KEY|DATABASE_URL|CONNECTION_STRING))\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
		(_match, name) => `${name}=${REDACTED}`,
	);
	replace(
		/\b(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{16})\b/g,
		REDACTED,
	);
	replace(
		/([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi,
		(_match, scheme) => `${scheme}${REDACTED}@`,
	);
	replace(
		/-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)* PRIVATE KEY-----/g,
		REDACTED,
	);
	return { text, count };
}

function truncate_utf8(value: string, max_bytes: number): string {
	if (Buffer.byteLength(value) <= max_bytes) return value;
	let bytes = 0;
	let result = '';
	for (const character of value) {
		const character_bytes = Buffer.byteLength(character);
		if (bytes + character_bytes > max_bytes) break;
		result += character;
		bytes += character_bytes;
	}
	return result;
}

export function sanitize_diagnostic_stream(
	value: string | undefined,
	max_bytes = DEFAULT_DIAGNOSTIC_MAX_BYTES,
): SafeDiagnosticStream {
	const input = value ?? '';
	const limit = Math.max(0, Math.floor(max_bytes));
	const redacted = redact_diagnostic_text(input);
	const text = truncate_utf8(redacted.text, limit);
	return {
		text,
		bytes: Buffer.byteLength(input),
		stored_bytes: Buffer.byteLength(text),
		truncated: Buffer.byteLength(redacted.text) > limit,
		redaction_count: redacted.count,
	};
}

/** Redact and bound process diagnostics before any transcript or DB write. */
export function sanitize_process_diagnostics(
	input: ProcessDiagnosticsInput,
	max_stream_bytes = DEFAULT_DIAGNOSTIC_MAX_BYTES,
): SafeProcessDiagnostics {
	const command = input.command
		? sanitize_diagnostic_stream(input.command, max_stream_bytes).text
		: undefined;
	return {
		...(command ? { command } : {}),
		exit_code: input.exit_code,
		...(input.signal !== undefined ? { signal: input.signal } : {}),
		timed_out: input.timed_out === true,
		stdout: sanitize_diagnostic_stream(
			input.stdout,
			max_stream_bytes,
		),
		stderr: sanitize_diagnostic_stream(
			input.stderr,
			max_stream_bytes,
		),
	};
}
