import type { PromptPresetMap } from './types.js';

export const DEFAULT_BASE_PROMPT_PRESET_NAME = 'terse';

export const DEFAULT_PROMPT_PRESETS: PromptPresetMap = {
	terse: {
		kind: 'base',
		description: 'Short, direct, no fluff',
		instructions:
			"Be concise and direct. Default to the shortest response that fully solves the user's request. Use at most one short paragraph or 3 bullets unless the user explicitly asks for detail. For implementation reports, include only what changed, validation, and the next step if relevant. No purple prose, no filler, no repetitive caveats.",
	},
	standard: {
		kind: 'base',
		description: 'Clear and concise with key context',
		instructions:
			'Be clear, direct, and concise. Include only the reasoning and implementation details that matter. Avoid filler, grandstanding, and ornamental language. Use bullets when they improve scanability.',
	},
	detailed: {
		kind: 'base',
		description: 'More explanation when nuance matters',
		instructions:
			'Be thorough when the task is complex or tradeoffs matter, but stay practical. Explain only the details that help the user decide, verify, or implement. Avoid purple prose and unnecessary scene-setting.',
	},
	'no-purple-prose': {
		kind: 'layer',
		description: 'Strip out ornamental language',
		instructions:
			'Do not use purple prose, flourish, motivational filler, or theatrical transitions. Prefer plain language and concrete statements.',
	},
	bullets: {
		kind: 'layer',
		description: 'Prefer short bullets when useful',
		instructions:
			'When presenting options, findings, or steps, prefer short bullet lists over long paragraphs.',
	},
	'clarify-first': {
		kind: 'layer',
		description:
			'Ask brief clarifying questions when requirements are ambiguous',
		instructions:
			'If the request is materially ambiguous, ask the minimum clarifying question(s) needed before proceeding. Do not ask unnecessary questions.',
	},
	'include-risks': {
		kind: 'layer',
		description: 'Call out notable risks or tradeoffs',
		instructions:
			'When making a recommendation or implementation plan, briefly mention the key risk, tradeoff, or caveat if one materially matters.',
	},
};
