import {
	clampThinkingLevel,
	getSupportedThinkingLevels,
	type ModelThinkingLevel,
} from '@earendil-works/pi-ai';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

const VALID_THINKING_LEVELS = new Set<ModelThinkingLevel>([
	'off',
	'minimal',
	'low',
	'medium',
	'high',
	'xhigh',
]);

function is_model_thinking_level(
	level: string,
): level is ModelThinkingLevel {
	return VALID_THINKING_LEVELS.has(level as ModelThinkingLevel);
}

export function get_default_footer_thinking_level(
	model: ExtensionContext['model'],
): ModelThinkingLevel {
	if (!model?.reasoning) return 'off';

	return clampThinkingLevel(model, 'medium');
}

export function get_current_thinking_level(
	ctx: Pick<ExtensionContext, 'model' | 'sessionManager'>,
): ModelThinkingLevel {
	const entries = ctx.sessionManager.getEntries();

	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as {
			type?: string;
			thinkingLevel?: string;
		};

		if (
			entry.type === 'thinking_level_change' &&
			entry.thinkingLevel !== undefined &&
			is_model_thinking_level(entry.thinkingLevel)
		) {
			if (!ctx.model?.reasoning) return 'off';

			return getSupportedThinkingLevels(ctx.model).includes(
				entry.thinkingLevel,
			)
				? entry.thinkingLevel
				: clampThinkingLevel(ctx.model, entry.thinkingLevel);
		}
	}

	return get_default_footer_thinking_level(ctx.model);
}
