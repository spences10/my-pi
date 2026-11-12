import type {
	ExtensionAPI,
	ToolCallEvent,
	ToolCallEventResult,
} from '@earendil-works/pi-coding-agent';
import * as v from 'valibot';
import {
	extract_input_strings,
	input_node_schema,
} from '@spences10/pi-settings';
import {
	is_path_allowed,
	load_svelte_guardrails_config,
	type SvelteGuardrailsConfig,
} from './config.js';

const SVELTE_FILE_RE = /\.svelte(?:\.|$|\?)/;

const edits_schema = v.fallback(
	v.array(
		v.fallback(
			v.optional(v.object({ newText: v.optional(v.unknown()) })),
			undefined,
		),
	),
	[],
);

const tool_input_schema = v.looseObject({
	path: v.optional(v.unknown()),
	file_path: v.optional(v.unknown()),
	filePath: v.optional(v.unknown()),
	content: v.optional(v.unknown()),
	newText: v.optional(v.unknown()),
	edits: v.optional(v.unknown()),
	command: v.optional(v.unknown()),
});

type SvelteToolInput = v.InferOutput<typeof tool_input_schema>;

const EFFECT_RE = /\$effect(?:\s*\(|\s*\.)/;

export function is_svelte_path(value: string): boolean {
	return SVELTE_FILE_RE.test(value);
}

export function contains_disallowed_effect(value: string): boolean {
	return EFFECT_RE.test(value);
}

export function find_svelte_path(
	input: SvelteToolInput,
): string | undefined {
	for (const value of [input.path, input.file_path, input.filePath]) {
		if (typeof value === 'string' && is_svelte_path(value))
			return value;
	}

	return undefined;
}

export function extract_bash_svelte_path(
	command: string,
): string | undefined {
	const redirect_match = command.match(
		/>\s*['"]?([^'"\s>]+\.svelte)['"]?\b/,
	);

	if (redirect_match?.[1]) return redirect_match[1];

	const tee_match = command.match(
		/\btee\b[^;&|]*\s+['"]?([^'"\s]+\.svelte)['"]?\b/,
	);

	if (tee_match?.[1]) return tee_match[1];

	const heredoc_match = command.match(
		/\bcat\b[^;&|]*>\s*['"]?([^'"\s>]+\.svelte)['"]?\b/,
	);

	return heredoc_match?.[1];
}

function effect_reason(
	path: string,
	mode: SvelteEffectAssessment['mode'],
): string {
	const alternatives =
		'Use $derived/$derived.by for computed state, event handlers or function bindings for user interactions, onMount with cleanup for mount-time setup, and attachments for element integrations. Effects are an escape hatch, not the default solution. External library imports do not grant an exception; ask the user for an explicit policy exception if an effect is unavoidable.';

	if (mode === 'warn') {
		return `Svelte guardrails warning: ${path} contains $effect. This tool call is allowed because warn mode was explicitly configured. ${alternatives}`;
	}

	return `Blocked by Svelte guardrails: ${path} was not created or modified. This project's policy disallows $effect. ${alternatives} Rewrite and retry the proposed change; do not report success until the replacement is written.`;
}

function proposed_content(
	input: SvelteToolInput,
	tool_name: string,
): string[] {
	if (tool_name === 'write')
		return extract_input_strings(
			v.parse(input_node_schema, input.content),
		);
	const edits = v.parse(edits_schema, input.edits);

	return extract_input_strings(
		v.parse(input_node_schema, [
			input.newText,
			...edits.map((edit) => edit?.newText),
		]),
	);
}

export interface SvelteEffectAssessment {
	mode: Exclude<SvelteGuardrailsConfig['mode'], 'off'>;
	reason: string;
}

export function assess_svelte_effect(
	event: ToolCallEvent,
	config: SvelteGuardrailsConfig = load_svelte_guardrails_config(),
	cwd = process.cwd(),
): SvelteEffectAssessment | undefined {
	if (!config.blockEffect || config.mode === 'off') return undefined;

	const input = v.parse(tool_input_schema, event.input);

	if (['write', 'edit'].includes(event.toolName)) {
		const path = find_svelte_path(input);

		if (!path || is_path_allowed(path, config.allow, cwd))
			return undefined;

		if (
			!proposed_content(input, event.toolName).some(
				contains_disallowed_effect,
			)
		)
			return undefined;

		return {
			mode: config.mode,
			reason: effect_reason(path, config.mode),
		};
	}

	if (event.toolName === 'bash') {
		const command = input.command;

		if (typeof command !== 'string') return undefined;

		if (!contains_disallowed_effect(command)) return undefined;
		const path = extract_bash_svelte_path(command);

		if (!path || is_path_allowed(path, config.allow, cwd))
			return undefined;

		return {
			mode: config.mode,
			reason: effect_reason(path, config.mode),
		};
	}

	return undefined;
}

export function should_block_svelte_effect(
	event: ToolCallEvent,
	config: SvelteGuardrailsConfig = load_svelte_guardrails_config(),
): string | undefined {
	const assessment = assess_svelte_effect(event, config);

	return assessment?.mode === 'block' ? assessment.reason : undefined;
}

export default function svelte_guardrails(pi: ExtensionAPI) {
	pi.on(
		'tool_call',
		async (event, ctx): Promise<ToolCallEventResult | undefined> => {
			const assessment = assess_svelte_effect(
				event,
				load_svelte_guardrails_config(ctx.cwd),
				ctx.cwd,
			);

			if (!assessment) return undefined;

			if (assessment.mode === 'warn') {
				ctx.ui.notify(assessment.reason, 'warning');

				return undefined;
			}

			return { block: true, reason: assessment.reason };
		},
	);
}
