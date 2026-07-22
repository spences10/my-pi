import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { start_factory } from './factory.js';
import { factory_start_params_schema } from './schema.js';

function text(value: unknown) {
	return {
		content: [
			{ type: 'text' as const, text: JSON.stringify(value, null, 2) },
		],
		details: value,
	};
}

export default function factory(pi: ExtensionAPI): void {
	pi.registerTool({
		name: 'factory_start',
		label: 'Start reviewed execution',
		description:
			'Run exactly one local Pi executor from an existing pi-harness contract, then deterministic validation and independent diff-bound review.',
		promptSnippet:
			'Run one owned local executor through validation and independent review',
		promptGuidelines: [
			'Use only when Factory is explicitly enabled for evaluation.',
			'Create the pi-harness contract first; factory_start is the one normal-path action.',
			'Do not use Factory for routing, peers, remote execution, or durable ownership.',
		],
		parameters: factory_start_params_schema,
		async execute(_id, params, signal) {
			return text(await start_factory({ ...params, signal }));
		},
	});
}
