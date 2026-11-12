import type { Context } from '@earendil-works/pi-ai';
import * as v from 'valibot';

const block_schema = v.looseObject({
	type: v.string(),
	text: v.optional(v.string()),
});

/** A message as far as suggestions care; anything unreadable counts as empty. */
const message_schema = v.fallback(
	v.looseObject({
		role: v.optional(v.string()),
		content: v.optional(v.union([v.string(), v.array(block_schema)])),
	}),
	{},
);

type MessageLike = v.InferOutput<typeof message_schema>;

const MAX_REPLY_CHARS = 4000;
const MAX_SUGGESTION_CHARS = 120;

const SYSTEM_PROMPT = `You predict the next message a developer will type to their coding agent.
Reply with only that message, in the developer's voice, at most 15 words.
No quotes, no preamble. If there is no obvious next step, reply with nothing.`;

function text_of(message: MessageLike | undefined): string {
	if (!message) return '';

	if (!Array.isArray(message.content)) return message.content ?? '';

	return message.content
		.filter((block) => block.type === 'text' && block.text)
		.map((block) => block.text)
		.join('\n');
}

/** Last user prompt and final agent reply, or undefined if either is missing. */
export function suggestion_context(
	messages: readonly unknown[],
): Context | undefined {
	const typed = messages
		.map((message) => v.parse(message_schema, message))
		.reverse();

	const user = text_of(
		typed.find((message) => message.role === 'user'),
	).trim();

	const reply = text_of(
		typed.find((message) => message.role === 'assistant'),
	).trim();

	if (!user || !reply) return undefined;

	return {
		systemPrompt: SYSTEM_PROMPT,
		messages: [
			{
				role: 'user',
				content: `Developer asked:\n${user}\n\nAgent replied:\n${reply.slice(-MAX_REPLY_CHARS)}`,
				timestamp: Date.now(),
			},
		],
	};
}

/** First line of the model reply, without wrapping quotes; undefined if empty. */
export function clean_suggestion(text: string): string | undefined {
	const line = text
		.trim()
		.split('\n')[0]!
		.trim()
		.replace(/^["'`“]+|["'`”]+$/g, '')
		.trim();

	return line ? line.slice(0, MAX_SUGGESTION_CHARS) : undefined;
}
