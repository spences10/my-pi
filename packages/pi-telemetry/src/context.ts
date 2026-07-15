import type {
	ExtensionContext,
	SessionShutdownEvent,
} from '@earendil-works/pi-coding-agent';
import type { EvalMetadata } from './types.js';

export function parse_int(value: string | undefined): number | null {
	if (!value) return null;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : null;
}

export function get_eval_metadata(): EvalMetadata {
	return {
		run_id: process.env.MY_PI_EVAL_RUN_ID ?? null,
		case_id: process.env.MY_PI_EVAL_CASE_ID ?? null,
		attempt: parse_int(process.env.MY_PI_EVAL_ATTEMPT),
		suite: process.env.MY_PI_EVAL_SUITE ?? null,
	};
}

export function get_model_identity(
	model:
		| Pick<NonNullable<ExtensionContext['model']>, 'id' | 'provider'>
		| null
		| undefined,
): {
	provider: string | null;
	id: string | null;
} {
	if (!model) {
		return { provider: null, id: null };
	}
	return {
		provider:
			typeof model.provider === 'string' ? model.provider : null,
		id: typeof model.id === 'string' ? model.id : null,
	};
}

export function get_session_file(
	ctx: ExtensionContext,
): string | null {
	const session_manager = ctx.sessionManager as {
		getSessionFile?: () => string | undefined;
	};
	return session_manager.getSessionFile?.() ?? null;
}

export function get_stop_reason(message: unknown): string | null {
	if (!message || typeof message !== 'object') return null;
	const stop_reason = (message as { stopReason?: unknown })
		.stopReason;
	return typeof stop_reason === 'string' ? stop_reason : null;
}

export function get_error_message(message: unknown): string | null {
	if (!message || typeof message !== 'object') return null;
	const error_message = (message as { errorMessage?: unknown })
		.errorMessage;
	return typeof error_message === 'string' ? error_message : null;
}

export function infer_run_outcome(event: {
	type?: unknown;
	messages: Array<{
		role: string;
		content?: unknown;
		stopReason?: unknown;
		errorMessage?: unknown;
	}>;
}): {
	success: boolean | null;
	error_message: string | null;
} {
	const assistant_messages = event.messages.filter(
		(message) => message.role === 'assistant',
	);
	const last_assistant = assistant_messages.at(-1);
	const stop_reason = get_stop_reason(last_assistant);
	if (stop_reason === 'error') {
		return {
			success: false,
			error_message:
				get_error_message(last_assistant) ?? 'agent error',
		};
	}
	if (stop_reason === 'aborted') {
		return {
			success: false,
			error_message:
				get_error_message(last_assistant) ?? 'agent aborted',
		};
	}
	return {
		success: true,
		error_message: null,
	};
}

export function describe_session_shutdown(
	event: Pick<SessionShutdownEvent, 'reason' | 'targetSessionFile'>,
): string {
	const base = `session shutdown (${event.reason})`;
	return event.targetSessionFile
		? `${base} → ${event.targetSessionFile}`
		: base;
}
