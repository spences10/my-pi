import type {
	ExtensionAPI,
	ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import { Type, type Static } from 'typebox';
import {
	QuestionPicker,
	type QuestionAnswer,
	type QuestionOptions,
} from './picker.js';
import {
	Questionnaire,
	answer_lines,
	type BatchAnswer,
} from './questionnaire.js';

const question_fields = {
	question: Type.String({
		minLength: 1,
		description: 'The question to display.',
	}),
	header: Type.Optional(
		Type.String({ description: 'Optional question tab label.' }),
	),
	options: Type.Array(
		Type.Object({
			label: Type.String(),
			description: Type.Optional(Type.String()),
			category: Type.Optional(
				Type.String({
					description:
						'Optional category tab. Choices remain selected across categories.',
				}),
			),
		}),
		{
			minItems: 1,
			description:
				'The complete option list; the user can filter it.',
		},
	),
	multiSelect: Type.Optional(Type.Boolean({ default: false })),
};

const parameters = Type.Object({
	question: Type.Optional(question_fields.question),
	options: Type.Optional(question_fields.options),
	multiSelect: question_fields.multiSelect,
	questions: Type.Optional(
		Type.Array(Type.Object(question_fields), {
			minItems: 1,
			description:
				'Independent questions shown in tabs, followed by review. Use instead of the top-level single-question fields.',
		}),
	),
});

export function normalise_questions(
	params: Static<typeof parameters>,
): QuestionOptions[] {
	if (params.questions !== undefined) {
		if (
			params.question !== undefined ||
			params.options !== undefined ||
			params.multiSelect !== undefined
		)
			throw new Error(
				'Provide either questions or the single-question fields, not both.',
			);

		if (!params.questions.length)
			throw new Error('Provide at least one question.');

		return params.questions;
	}

	if (!params.question || !params.options?.length)
		throw new Error(
			'Provide question and options, or a questions array.',
		);

	return [
		{
			question: params.question,
			options: params.options,
			multiSelect: params.multiSelect,
		},
	];
}

type QuestionDetails =
	| ((QuestionAnswer | BatchAnswer) & { status: 'answered' })
	| { cancelled: true; status: 'dismissed' | 'aborted' }
	| { unavailable: true; status: 'unavailable' };

export function create_question_tool(): ToolDefinition<
	typeof parameters,
	QuestionDetails
> {
	return {
		name: 'ask_user_question',
		label: 'Ask user',
		description:
			'Offer one optional searchable choice list or a tabbed questionnaire with review. Options can have categories; each question supports single or multiple selections, Other text and a comment. Pass complete lists. The user can dismiss to talk instead; dismissal is not task rejection or approval.',
		promptSnippet:
			'Optional type-to-search lists with category tabs or multiple question tabs, multiselect, Other and comments; Escape returns to chat.',
		promptGuidelines: [
			'Use ask_user_question to help select from a concrete list, such as projects or dependencies. It is a convenience, not a decision gate.',
			'Do not force exploratory conversation into a menu or invent choices that narrow the user’s intent. Plain conversation is appropriate.',
			'If dismissed, wait for the user to talk. Do not immediately re-ask, infer an answer, or treat dismissal as rejection of the task.',
			'Preserve comments and custom text as qualifications of the answer; an empty selection or unanswered question is not approval for other work.',
			'Use categories to group options within one decision; use questions for separate decisions. Neither is required for a simple list.',
		],
		parameters,
		executionMode: 'sequential',
		async execute(_id, params, signal, _update, ctx) {
			if (signal?.aborted) {
				return {
					content: [
						{
							type: 'text',
							text: 'Question interrupted. No answer submitted.',
						},
					],
					details: { cancelled: true, status: 'aborted' },
				};
			}

			if (ctx.mode !== 'tui') {
				return {
					content: [
						{
							type: 'text',
							text: 'Question UI unavailable. Ask in plain chat instead; the user has not declined.',
						},
					],
					details: { unavailable: true, status: 'unavailable' },
				};
			}

			const questions = normalise_questions(params);

			const answer = await ctx.ui.custom<
				QuestionAnswer | BatchAnswer | null
			>(
				(tui, theme, keybindings, done) => {
					if (params.questions)
						return new Questionnaire(
							questions,
							tui,
							theme,
							keybindings,
							done,
							signal,
						);

					return new QuestionPicker(
						questions[0],
						tui,
						theme,
						keybindings,
						done,
						signal,
					);
				},
				{
					blocked: {
						kind: 'question',
						message: 'Waiting for your answer',
					},
				},
			);

			if (answer === null) {
				const interrupted = signal?.aborted === true;

				// Abort, rather than only terminate, also stops follow-up from a mixed tool batch.
				if (!interrupted) ctx.abort();

				return {
					content: [
						{
							type: 'text',
							text: 'Question dismissed. Wait for the user to continue in chat. No answer or approval given; the task itself was not rejected.',
						},
					],
					details: {
						cancelled: true,
						status: interrupted ? 'aborted' : 'dismissed',
					},
					terminate: true,
				};
			}

			return {
				content: [{ type: 'text', text: JSON.stringify(answer) }],
				details: { ...answer, status: 'answered' },
			};
		},
		renderCall(args, theme) {
			return new Text(
				theme.fg('toolTitle', 'Ask user ') +
					(args.question ??
						`${args.questions?.length ?? 0} questions`),
				0,
				0,
			);
		},
		renderResult(result, _options, theme) {
			const details = result.details;

			if (!details || details.status === 'unavailable')
				return new Text(
					theme.fg('muted', 'Question UI unavailable'),
					0,
					0,
				);

			if (details.status !== 'answered')
				return new Text(
					theme.fg('muted', 'Back to chat · no answer submitted'),
					0,
					0,
				);

			const lines =
				'responses' in details
					? details.responses.flatMap((response) => [
							response.question,
							...(response.answer
								? answer_lines(response.answer)
								: ['Unanswered (no choice inferred)']),
						])
					: answer_lines(details);

			return new Text(lines.join('\n'), 0, 0);
		},
	};
}

export default function ask_user(pi: ExtensionAPI): void {
	pi.registerTool(create_question_tool());
}
