import type {
	ToolCallEvent,
	ToolResultEvent,
} from '@earendil-works/pi-coding-agent';
import * as v from 'valibot';

type ToolResultContent = ToolResultEvent['content'][number];

const optional_string = v.fallback(v.optional(v.string()), undefined);

const edit_schema = v.fallback(
	v.looseObject({
		oldText: optional_string,
		newText: optional_string,
	}),
	{ oldText: undefined, newText: undefined },
);

/**
 * Tool input is model-supplied, so the SDK types are not trusted:
 * malformed fields decode to undefined (or an empty edit list).
 */
export const tool_input_schema = v.looseObject({
	command: optional_string,
	path: optional_string,
	query: optional_string,
	edits: v.fallback(v.array(edit_schema), []),
});

export type ToolInput = v.InferOutput<typeof tool_input_schema>;

export function parse_tool_input(
	input: ToolCallEvent['input'],
): ToolInput {
	return v.parse(tool_input_schema, input);
}

const text_part_schema = v.looseObject({ text: v.string() });

/** Return a content part's text, or an empty string when it has none. */
export function part_text(part: ToolResultContent): string {
	const parsed = v.safeParse(text_part_schema, part);

	return parsed.success ? parsed.output.text : '';
}
