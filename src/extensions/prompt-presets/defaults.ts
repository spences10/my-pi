import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import type { PromptPreset, PromptPresetMap } from './types.js';

import asd_ste100 from './defaults/asd-ste100.md';
import bullets from './defaults/bullets.md';
import clarify_first from './defaults/clarify-first.md';
import detailed from './defaults/detailed.md';
import include_risks from './defaults/include-risks.md';
import karpathy from './defaults/karpathy.md';
import no_purple_prose from './defaults/no-purple-prose.md';
import spence from './defaults/spence.md';
import standard from './defaults/standard.md';
import terse from './defaults/terse.md';

export const DEFAULT_BASE_PROMPT_PRESET_NAME = 'terse';

const DEFAULT_PROMPT_PRESET_FILES = {
	terse,
	standard,
	detailed,
	'no-purple-prose': no_purple_prose,
	'asd-ste100': asd_ste100,
	bullets,
	'clarify-first': clarify_first,
	'include-risks': include_risks,
	karpathy,
	spence,
} satisfies Record<string, string>;

function parse_default_prompt_preset(content: string): PromptPreset {
	const { frontmatter, body } = parseFrontmatter(content);
	return {
		kind: frontmatter.kind === 'layer' ? 'layer' : 'base',
		instructions: body.trim(),
		...(typeof frontmatter.description === 'string' &&
		frontmatter.description.trim()
			? { description: frontmatter.description.trim() }
			: {}),
	};
}

export const DEFAULT_PROMPT_PRESETS: PromptPresetMap =
	Object.fromEntries(
		Object.entries(DEFAULT_PROMPT_PRESET_FILES).map(
			([name, content]) => [
				name,
				parse_default_prompt_preset(content),
			],
		),
	);
