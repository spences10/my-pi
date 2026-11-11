const response_text_chars = 16_000;

/** Only visible assistant text, never thinking, tool arguments or images. */
export function assistant_text(message: unknown): {
	text: string;
	truncated: boolean;
} | null {
	if (!message || typeof message !== 'object') return null;
	const record = message as Record<string, unknown>;

	if (record.role !== 'assistant') return null;
	let text = '';

	if (typeof record.content === 'string') text = record.content;
	else if (Array.isArray(record.content))
		text = record.content
			.flatMap((block: unknown) => {
				if (!block || typeof block !== 'object') return [];
				const part = block as Record<string, unknown>;

				return part.type === 'text' && typeof part.text === 'string'
					? [part.text]
					: [];
			})
			.join('\n');

	return {
		text: text.slice(0, response_text_chars),
		truncated: text.length > response_text_chars,
	};
}
