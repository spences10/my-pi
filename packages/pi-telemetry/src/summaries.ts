export function safe_json_stringify(value: unknown): string | null {
	if (value === undefined) return null;
	try {
		return JSON.stringify(value);
	} catch {
		return JSON.stringify({
			type: typeof value,
			unserializable: true,
		});
	}
}

export function summarize_value(value: unknown, depth = 0): unknown {
	if (value == null) return null;
	if (typeof value === 'string') {
		return {
			type: 'string',
			bytes: Buffer.byteLength(value, 'utf-8'),
			lines: value === '' ? 0 : value.split(/\r?\n/).length,
		};
	}
	if (
		typeof value === 'number' ||
		typeof value === 'boolean' ||
		typeof value === 'bigint'
	) {
		return value;
	}
	if (Array.isArray(value)) {
		return {
			type: 'array',
			length: value.length,
			items:
				depth >= 1
					? undefined
					: value
							.slice(0, 5)
							.map((item) => summarize_value(item, depth + 1)),
		};
	}
	if (typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>);
		const summary: Record<string, unknown> = {
			type: 'object',
			keys: entries.map(([key]) => key).slice(0, 20),
		};
		if (depth < 1) {
			for (const [key, child] of entries.slice(0, 10)) {
				if (
					key === 'oldText' ||
					key === 'newText' ||
					key === 'content' ||
					key === 'text'
				) {
					summary[`${key}_summary`] = summarize_value(
						child,
						depth + 1,
					);
					continue;
				}
				summary[key] = summarize_value(child, depth + 1);
			}
		}
		return summary;
	}
	return {
		type: typeof value,
	};
}

export function summarize_tool_args(
	tool_name: string,
	args: unknown,
): string | null {
	if (!args || typeof args !== 'object') {
		return safe_json_stringify(summarize_value(args));
	}

	const input = args as Record<string, unknown>;
	switch (tool_name) {
		case 'bash':
			return safe_json_stringify({
				tool: tool_name,
				timeout: input.timeout ?? null,
				command: summarize_value(input.command),
			});
		case 'read':
		case 'write':
		case 'edit':
			return safe_json_stringify({
				tool: tool_name,
				path: typeof input.path === 'string' ? input.path : null,
				offset:
					typeof input.offset === 'number' ? input.offset : null,
				limit: typeof input.limit === 'number' ? input.limit : null,
				content: summarize_value(input.content),
				edits: summarize_value(input.edits),
			});
		default:
			return safe_json_stringify({
				tool: tool_name,
				summary: summarize_value(args),
			});
	}
}

export function summarize_tool_result(
	result: unknown,
): string | null {
	return safe_json_stringify(summarize_value(result));
}

export function summarize_headers(
	headers: Record<string, string>,
): string | null {
	return safe_json_stringify({
		keys: Object.keys(headers).slice(0, 20),
		count: Object.keys(headers).length,
	});
}

export function summarize_provider_payload(
	payload: unknown,
): string | null {
	return safe_json_stringify(summarize_value(payload));
}
