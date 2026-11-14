import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import * as v from 'valibot';
import {
	create_output_filter,
	create_redactor,
	redact_entries,
	redact_message,
	redacting_bash_operations,
} from './output.js';

export {
	looks_like_ssh_config,
	redact_ssh_config_metadata,
	redact_text,
	type RedactionOptions,
	type RedactionResult,
} from './redaction.js';

const registration_schema = v.object({
	values: v.array(v.string()),
});

export default function filter_output(pi: ExtensionAPI) {
	const redactor = create_redactor();
	const output = create_output_filter(redactor.text);
	let unsubscribe: (() => void) | undefined;

	function subscribe() {
		unsubscribe ??= pi.events.on(
			'pi-redact:register-secrets',
			(data) => {
				const parsed = v.safeParse(registration_schema, data);

				if (parsed.success) redactor.register(parsed.output.values);
			},
		);
	}

	subscribe();
	pi.on('session_start', subscribe);
	pi.on('session_shutdown', () => {
		unsubscribe?.();
		unsubscribe = undefined;
		redactor.clear();
		output.clear();
	});

	pi.on('tool_call', output.tool_call);
	pi.on('tool_result', output.tool_result);

	pi.on('message_end', (event) => ({
		message: redact_message(event.message, redactor.text),
	}));
	pi.on('context', (event) => ({
		messages: event.messages.map((message) =>
			redact_message(message, redactor.text, true),
		),
	}));
	pi.on('context_with_system', (event) => ({
		messages: event.messages.map((message) =>
			redact_message(message, redactor.text, true),
		),
	}));
	pi.on('user_bash', async () => {
		const { createLocalBashOperations } =
			await import('@earendil-works/pi-coding-agent');

		return {
			operations: redacting_bash_operations(
				createLocalBashOperations({
					shellPath: pi.getSettings().shellPath,
				}),
				redactor.text,
				() => redactor.known_values,
			),
		};
	});

	pi.on('session_before_compact', (event) => {
		const preparation = event.preparation;
		preparation.messagesToSummarize =
			preparation.messagesToSummarize.map((message) =>
				redact_message(message, redactor.text, true),
			);
		preparation.turnPrefixMessages =
			preparation.turnPrefixMessages.map((message) =>
				redact_message(message, redactor.text, true),
			);
		preparation.previousSummary =
			preparation.previousSummary &&
			redactor.text(preparation.previousSummary);
		preparation.fileOps = {
			read: new Set(
				[...preparation.fileOps.read].map((path) =>
					redactor.text(path),
				),
			),
			edited: new Set(
				[...preparation.fileOps.edited].map((path) =>
					redactor.text(path),
				),
			),
			written: new Set(
				[...preparation.fileOps.written].map((path) =>
					redactor.text(path),
				),
			),
		};
		redact_entries(event.branchEntries, redactor.text);
	});
	pi.on('session_before_tree', (event) => {
		redact_entries(
			event.preparation.entriesToSummarize,
			redactor.text,
		);

		if (event.preparation.customInstructions !== undefined)
			return {
				customInstructions: redactor.text(
					event.preparation.customInstructions,
				),
			};
	});

	pi.registerCommand('redact-stats', {
		description: 'Show how many secrets have been redacted',
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				`Secrets redacted this session: ${redactor.total}`,
			);
		},
	});
}
