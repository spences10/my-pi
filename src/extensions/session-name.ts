// Session name — AI-powered session naming
// Adapted from Thomas Lopes' pi dotfiles

import { complete, type Message } from '@mariozechner/pi-ai';
import type { ExtensionAPI, SessionEntry } from '@mariozechner/pi-coding-agent';
import {
	BorderedLoader,
	convertToLlm,
	serializeConversation,
} from '@mariozechner/pi-coding-agent';

const SYSTEM_PROMPT = `You are a session naming assistant. Given a conversation history, generate a short, descriptive session name (2-5 words) that captures the main topic or task.

Guidelines:
- Be concise but specific
- Use kebab-case or natural language
- Focus on the core task/question
- Avoid generic names like "discussion" or "conversation"
- No quotes, no punctuation at the end

Examples:
- "fix auth bug" -> "fix-auth-bug" or "authentication fix"
- "how do I deploy to vercel" -> "vercel deployment"
- "explain react hooks" -> "react hooks explanation"
- "optimize database queries" -> "db query optimization"

Output ONLY the session name, nothing else.`;

const AUTO_NAME_THRESHOLD = 1;
const MAX_CHARS = 4000;
const MAX_NAME_LEN = 50;

function clean_name(value: string): string {
	return value
		.replace(/^["']|["']$/g, '')
		.replace(/\n/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, MAX_NAME_LEN);
}

function truncate_conversation(value: string): string {
	return value.length > MAX_CHARS
		? value.slice(0, MAX_CHARS) + '\n...'
		: value;
}

async function generate_session_name(
	ctx: {
		modelRegistry: {
			getApiKeyAndHeaders: (
				model: NonNullable<
					Parameters<
						Parameters<ExtensionAPI['registerCommand']>[1]['handler']
					>[1]['model']
				>,
			) => Promise<any>;
		};
	},
	model: NonNullable<
		Parameters<Parameters<ExtensionAPI['registerCommand']>[1]['handler']>[1]['model']
	>,
	conversation_text: string,
	signal?: AbortSignal,
): Promise<string | null> {
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) {
		throw new Error(
			auth.ok ? `No API key for ${model.provider}` : auth.error,
		);
	}

	const user_message: Message = {
		role: 'user',
		content: [
			{
				type: 'text',
				text: `## Conversation History\n\n${truncate_conversation(conversation_text)}\n\nGenerate a concise session name for this conversation.`,
			},
		],
		timestamp: Date.now(),
	};

	const response = await complete(
		model,
		{ systemPrompt: SYSTEM_PROMPT, messages: [user_message] },
		{ apiKey: auth.apiKey, headers: auth.headers, signal },
	);

	if (response.stopReason === 'aborted') {
		return null;
	}

	return clean_name(
		response.content
			.filter(
				(c): c is { type: 'text'; text: string } =>
					c.type === 'text',
			)
			.map((c) => c.text.trim())
			.join(' '),
	);
}

export default async function session_name(pi: ExtensionAPI) {
	let auto_named_attempted = false;

	pi.on('agent_end', async (_event, ctx) => {
		if (!ctx.hasUI || !ctx.model) return;
		if (pi.getSessionName() || auto_named_attempted) return;

		const branch = ctx.sessionManager.getBranch();
		const user_messages = branch.filter(
			(entry): entry is SessionEntry & { type: 'message' } =>
				entry.type === 'message' && entry.message.role === 'user',
		);
		if (user_messages.length < AUTO_NAME_THRESHOLD) return;

		auto_named_attempted = true;
		const messages = branch
			.filter(
				(entry): entry is SessionEntry & { type: 'message' } =>
					entry.type === 'message',
			)
			.map((entry) => entry.message);
		if (messages.length === 0) return;

		const conversation_text = serializeConversation(
			convertToLlm(messages),
		);

		generate_session_name(ctx, ctx.model, conversation_text)
			.then((name) => {
				if (!name) return;
				pi.setSessionName(name);
				ctx.ui.notify(`Auto-named: ${name}`, 'info');
			})
			.catch((err) => {
				console.error('Auto-naming failed:', err);
			});
	});

	pi.on('session_start', async () => {
		auto_named_attempted = false;
	});

	pi.registerCommand('session-name', {
		description:
			'Set, show, or auto-generate the current session name',
		handler: async (args, ctx) => {
			const trimmed = args.trim();

			if (!trimmed) {
				const current = pi.getSessionName();
				ctx.ui.notify(
					current ? `Session: ${current}` : 'No session name set',
					'info',
				);
				return;
			}

			if (trimmed === '--auto' || trimmed === '-a') {
				if (!ctx.hasUI || !ctx.model) {
					ctx.ui.notify(
						'Auto-naming requires interactive mode and a selected model',
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
					ctx.ui.notify('No conversation to analyze', 'error');
					return;
				}

				const conversation_text = serializeConversation(
					convertToLlm(messages),
				);

				const result = await ctx.ui.custom<string | null>(
					(tui, theme, _kb, done) => {
						const loader = new BorderedLoader(
							tui,
							theme,
							'Generating session name...',
						);
						loader.onAbort = () => done(null);

						generate_session_name(
							ctx,
							ctx.model!,
							conversation_text,
							loader.signal,
						)
							.then(done)
							.catch((err) => {
								console.error('Auto-naming failed:', err);
								done(null);
							});

						return loader;
					},
				);

				if (result === null) {
					ctx.ui.notify('Auto-naming cancelled', 'info');
					return;
				}
				if (!result) {
					ctx.ui.notify('Failed to generate name', 'error');
					return;
				}

				pi.setSessionName(result);
				ctx.ui.notify(`Session named: ${result}`, 'info');
				return;
			}

			pi.setSessionName(clean_name(trimmed));
			ctx.ui.notify(`Session named: ${clean_name(trimmed)}`, 'info');
		},
	});
}
