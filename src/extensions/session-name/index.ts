// Session name — AI-powered session naming
// Adapted from Thomas Lopes' pi dotfiles

import { complete, type Message } from '@earendil-works/pi-ai/compat';
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	SessionEntry,
} from '@earendil-works/pi-coding-agent';
import {
	BorderedLoader,
	convertToLlm,
	serializeConversation,
} from '@earendil-works/pi-coding-agent';

const SYSTEM_PROMPT = `You are a session naming assistant. Given a conversation history, generate a short, descriptive session name (2-5 words) that captures the main topic or task.

Guidelines:
- Be concise but specific
- Use kebab-case only
- Focus on the core task/question
- Avoid generic names like "discussion" or "conversation"
- No quotes, no punctuation at the end

Examples:
- "fix auth bug" -> "fix-auth-bug"
- "how do I deploy to vercel" -> "vercel-deployment"
- "explain react hooks" -> "react-hooks-explanation"
- "optimize database queries" -> "db-query-optimization"

Output ONLY the session name, nothing else.`;

const AUTO_NAME_THRESHOLD = 1;
const MAX_CHARS = 4000;
const MAX_NAME_LEN = 50;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1_500, 4_000];

export function clean_name(value: string): string {
	return value
		.replace(/^["']|["']$/g, '')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, MAX_NAME_LEN)
		.replace(/-+$/g, '');
}

function truncate_conversation(value: string): string {
	return value.length > MAX_CHARS
		? value.slice(0, MAX_CHARS) + '\n...'
		: value;
}

export function is_transient_error(message: string): boolean {
	return (
		/\b(429|500|502|503|529)\b/.test(message) ||
		/overload|rate.?limit|temporarily unavailable|try again/i.test(
			message,
		)
	);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			'abort',
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
	});
}

async function complete_with_retry(
	model: Parameters<typeof complete>[0],
	context: Parameters<typeof complete>[1],
	options: NonNullable<Parameters<typeof complete>[2]>,
): Promise<Awaited<ReturnType<typeof complete>>> {
	let last_error: unknown = new Error('Unknown provider error');
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		if (attempt > 0) {
			await sleep(RETRY_DELAYS_MS[attempt - 1], options.signal);
			if (options.signal?.aborted) break;
		}
		try {
			const response = await complete(model, context, options);
			if (response.stopReason !== 'error') return response;
			const message = response.errorMessage ?? 'Provider error';
			if (!is_transient_error(message)) return response;
			last_error = new Error(message);
		} catch (err) {
			const message =
				err instanceof Error ? err.message : String(err);
			if (options.signal?.aborted || !is_transient_error(message)) {
				throw err;
			}
			last_error = err;
		}
	}
	throw last_error;
}

async function generate_session_name(
	ctx: Pick<ExtensionCommandContext, 'modelRegistry'>,
	model: NonNullable<
		Parameters<
			Parameters<ExtensionAPI['registerCommand']>[1]['handler']
		>[1]['model']
	>,
	conversation_text: string,
	signal?: AbortSignal,
): Promise<string | null> {
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || (!auth.apiKey && !auth.headers)) {
		throw new Error(
			auth.ok
				? `No credentials for ${model.provider} (API key or OAuth login required)`
				: auth.error,
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

	const response = await complete_with_retry(
		model,
		{ systemPrompt: SYSTEM_PROMPT, messages: [user_message] },
		{ apiKey: auth.apiKey, headers: auth.headers, signal },
	);

	if (response.stopReason === 'aborted') {
		return null;
	}

	if (response.stopReason === 'error') {
		throw new Error(
			response.errorMessage ??
				`Provider error from ${model.provider}`,
		);
	}

	return clean_name(
		response.content
			.filter(
				(c): c is { type: 'text'; text: string } => c.type === 'text',
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
