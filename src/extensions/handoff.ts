// Handoff extension — generate a focused prompt for a new session

import { complete, type Message } from '@mariozechner/pi-ai';
import type {
	ExtensionAPI,
	SessionEntry,
} from '@mariozechner/pi-coding-agent';
import {
	BorderedLoader,
	convertToLlm,
	serializeConversation,
} from '@mariozechner/pi-coding-agent';

const SYSTEM_PROMPT = `You are a context transfer assistant. Given a conversation history and the user's goal for a new thread, generate a focused prompt that:

1. Summarizes relevant context from the conversation (decisions made, approaches taken, key findings)
2. Lists any relevant files that were discussed or modified
3. Clearly states the next task based on the user's goal
4. Is self-contained - the new thread should be able to proceed without the old conversation

Format your response as a prompt the user can send to start the new thread. Be concise but include all necessary context. Do not include any preamble like "Here's the prompt" - just output the prompt itself.

Example output format:
## Context
We've been working on X. Key decisions:
- Decision 1
- Decision 2

Files involved:
- path/to/file1.ts
- path/to/file2.ts

## Task
[Clear description of what to do next based on user's goal]`;

export default async function handoff(pi: ExtensionAPI) {
	pi.registerCommand('handoff', {
		description:
			'Transfer context to a new focused session with an AI-generated prompt',
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify('handoff requires interactive mode', 'error');
				return;
			}

			if (!ctx.model) {
				ctx.ui.notify('No model selected', 'error');
				return;
			}

			const goal = args.trim();
			if (!goal) {
				ctx.ui.notify(
					'Usage: /handoff <goal for new thread>',
					'error',
				);
				return;
			}

			const branch = ctx.sessionManager.getBranch();
			const messages = branch
				.filter(
					(entry): entry is SessionEntry & { type: 'message' } =>
						entry.type === 'message',
				)
				.map((entry) => entry.message);

			if (messages.length === 0) {
				ctx.ui.notify('No conversation to hand off', 'error');
				return;
			}

			const llm_messages = convertToLlm(messages);
			const conversation_text = serializeConversation(llm_messages);
			const current_session_file =
				ctx.sessionManager.getSessionFile();
			const model = ctx.model;

			const result = await ctx.ui.custom<string | null>(
				(tui, theme, _kb, done) => {
					const loader = new BorderedLoader(
						tui,
						theme,
						'Generating handoff prompt...',
					);
					loader.onAbort = () => done(null);

					const generate = async () => {
						const auth =
							await ctx.modelRegistry.getApiKeyAndHeaders(model);
						if (!auth.ok || !auth.apiKey) {
							throw new Error(
								auth.ok
									? `No API key for ${model.provider}`
									: auth.error,
							);
						}

						const user_message: Message = {
							role: 'user',
							content: [
								{
									type: 'text',
									text: `## Conversation History\n\n${conversation_text}\n\n## User's Goal for New Thread\n\n${goal}`,
								},
							],
							timestamp: Date.now(),
						};

						const response = await complete(
							model,
							{
								systemPrompt: SYSTEM_PROMPT,
								messages: [user_message],
							},
							{
								apiKey: auth.apiKey,
								headers: auth.headers,
								signal: loader.signal,
							},
						);

						if (response.stopReason === 'aborted') {
							return null;
						}

						return response.content
							.filter(
								(c): c is { type: 'text'; text: string } =>
									c.type === 'text',
							)
							.map((c) => c.text)
							.join('\n');
					};

					generate()
						.then(done)
						.catch((err) => {
							console.error('Handoff generation failed:', err);
							done(null);
						});

					return loader;
				},
			);

			if (result === null) {
				ctx.ui.notify('Cancelled', 'info');
				return;
			}

			const edited_prompt = await ctx.ui.editor(
				'Edit handoff prompt',
				result,
			);
			if (edited_prompt === undefined) {
				ctx.ui.notify('Cancelled', 'info');
				return;
			}

			const new_session_result = await ctx.newSession({
				parentSession: current_session_file,
				withSession: async (replacement_ctx) => {
					replacement_ctx.ui.setEditorText(edited_prompt);
					replacement_ctx.ui.notify(
						'Handoff ready. Submit when ready.',
						'info',
					);
				},
			});
			if (new_session_result.cancelled) {
				ctx.ui.notify('New session cancelled', 'info');
			}
		},
	});
}
