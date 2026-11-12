import * as v from 'valibot';

export type ValueSummary =
	| null
	| undefined
	| string
	| number
	| boolean
	| bigint
	| ValueSummary[]
	| { [key: string]: ValueSummary };

/** Any runtime value a tool argument, result or provider payload can hold. */
export type SummarizableValue =
	| null
	| undefined
	| string
	| number
	| boolean
	| bigint
	| symbol
	| ((...args: never[]) => void)
	| SummarizableValue[]
	| { [key: string]: SummarizableValue };

/** Shallow boundary parse for payloads typed `unknown` by the SDK. */
export const summarizable_schema: v.GenericSchema<
	unknown,
	SummarizableValue
> = v.fallback(
	v.union([
		v.null(),
		v.undefined(),
		v.string(),
		v.number(),
		v.boolean(),
		v.bigint(),
		v.symbol(),
		v.function(),
		v.array(v.any()),
		v.record(v.string(), v.any()),
	]),
	null,
);

interface ObjectValueSummary {
	type: ValueSummary;
	keys: ValueSummary;
	[key: string]: ValueSummary;
}

export function safe_json_stringify(
	value: SummarizableValue,
): string | null {
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

export function summarize_value(
	value: SummarizableValue,
	depth = 0,
): ValueSummary {
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
		const entries = Object.entries(value);

		const summary: ObjectValueSummary = {
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
	args: SummarizableValue,
): string | null {
	if (!args || typeof args !== 'object') {
		return safe_json_stringify(summarize_value(args));
	}

	// SAFETY: `args` is non-null and an object here; arrays have no named fields, so the lookups below read undefined.
	const input = args as { [key: string]: SummarizableValue };

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
	result: SummarizableValue,
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
	payload: SummarizableValue,
): string | null {
	return safe_json_stringify(summarize_value(payload));
}
