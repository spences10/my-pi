import * as v from 'valibot';

const response_text_chars = 16_000;

const optional_string = v.fallback(v.optional(v.string()), undefined);

const content_block_schema = v.fallback(
	v.object({ type: optional_string, text: optional_string }),
	{ type: undefined, text: undefined },
);

const message_view_schema = v.object({
	role: optional_string,
	content: v.fallback(
		v.optional(v.union([v.string(), v.array(content_block_schema)])),
		undefined,
	),
	model: optional_string,
	responseModel: optional_string,
	keys: v.fallback(v.optional(v.array(v.string())), undefined),
});

/** The parts of a stored or live message the observability code reads. */
export type MessageView = v.InferOutput<typeof message_view_schema>;

/** Reads a message from an event payload; non-messages read as absent. */
export const message_schema = v.fallback(
	v.optional(message_view_schema),
	undefined,
);

/** Only visible assistant text, never thinking, tool arguments or images. */
export function assistant_text(message: MessageView): {
	text: string;
	truncated: boolean;
} | null {
	if (message.role !== 'assistant') return null;
	let text = '';

	if (typeof message.content === 'string') text = message.content;
	else if (message.content)
		text = message.content
			.flatMap((part) =>
				part.type === 'text' && part.text !== undefined
					? [part.text]
					: [],
			)
			.join('\n');

	return {
		text: text.slice(0, response_text_chars),
		truncated: text.length > response_text_chars,
	};
}
