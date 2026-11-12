import * as v from 'valibot';

const shell_output_schema = v.object({
	output: v.string(),
	truncated: v.fallback(v.boolean(), false),
	full_output_path: v.fallback(v.optional(v.string()), undefined),
});

const mcp_output_schema = v.object({
	content: v.array(
		v.union([
			v.object({ type: v.literal('text'), text: v.string() }),
			v.object({ type: v.literal('image') }),
		]),
	),
});

/** Prefer native machine-readable output over an already truncated chat preview. */
export function select_context_output(
	event: {
		toolName: string;
		structuredContent?: unknown;
		details?: unknown;
	},
	visible_text: string,
): string {
	if (event.toolName === 'bash' || event.toolName === 'powershell') {
		const parsed = v.safeParse(
			shell_output_schema,
			event.structuredContent,
		);

		if (parsed.success) {
			const structured = parsed.output;

			if (structured.truncated) {
				const path =
					structured.full_output_path !== undefined
						? ` Full output: ${structured.full_output_path}`
						: '';

				return `[Partial native output; omitted text is not indexed.${path}]\n${structured.output}`;
			}

			return structured.output;
		}
	}

	if (event.toolName.startsWith('mcp__')) {
		const parsed = v.safeParse(
			mcp_output_schema,
			event.structuredContent,
		);

		if (parsed.success) {
			const text = parsed.output.content.filter(
				(item) => item.type === 'text',
			);

			if (text.length > 0)
				return text.map((item) => item.text).join('\n');
		}
	}

	const details = event.details;

	const truncation =
		details && typeof details === 'object' && 'truncation' in details
			? details.truncation
			: undefined;

	const truncated =
		truncation &&
		typeof truncation === 'object' &&
		'truncated' in truncation &&
		truncation.truncated === true;

	if (
		details &&
		typeof details === 'object' &&
		(truncated ||
			('fullOutputPath' in details && details.fullOutputPath))
	) {
		return `[Partial native output; omitted text is not indexed.]\n${visible_text}`;
	}

	return visible_text;
}
