const SECRET_KEY_RE =
	/(api[_-]?key|authorization|bearer|client[_-]?secret|cookie|password|secret|token)/i;
const SECRET_VALUE_PATTERNS = [
	/\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g,
	/\b(?:sk|pk|ghp|github_pat|glpat|xox[baprs])-?[A-Za-z0-9_-]{20,}\b/g,
];

export function redact_text(value: string): string {
	let redacted = value;
	for (const pattern of SECRET_VALUE_PATTERNS) {
		redacted = redacted.replace(pattern, '[REDACTED]');
	}
	return redacted;
}

export function redact_value(value: unknown): unknown {
	if (typeof value === 'string') return redact_text(value);
	if (Array.isArray(value))
		return value.map((item) => redact_value(item));
	if (!value || typeof value !== 'object') return value;

	const output: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		output[key] = SECRET_KEY_RE.test(key)
			? '[REDACTED]'
			: redact_value(item);
	}
	return output;
}

export function safe_json(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return JSON.stringify({ unserializable: true });
	}
}

export function truncate_json_value(
	value: unknown,
	max_bytes: number,
): unknown {
	const json = safe_json(value);
	if (Buffer.byteLength(json, 'utf8') <= max_bytes) return value;
	return {
		truncated: true,
		bytes: Buffer.byteLength(json, 'utf8'),
		preview: json.slice(0, Math.max(0, max_bytes)),
	};
}
