import {
	clampThinkingLevel,
	type Api,
	type Model,
} from '@earendil-works/pi-ai';
import type { MyPiThinkingLevel } from './options.js';

interface ModelRegistryLike {
	getAll(): Model<Api>[];
}

export function resolve_model_reference(
	model_reference: string | undefined,
	model_registry: ModelRegistryLike,
): Model<Api> | undefined {
	if (!model_reference) return undefined;
	const models = model_registry.getAll();
	const lower_reference = model_reference.toLowerCase();
	const slash_index = model_reference.indexOf('/');

	if (slash_index !== -1) {
		const maybe_provider = model_reference.slice(0, slash_index);
		const model_id = model_reference.slice(slash_index + 1);
		const provider = models.find(
			(model) =>
				model.provider.toLowerCase() === maybe_provider.toLowerCase(),
		)?.provider;

		if (provider) {
			const provider_match = models.find(
				(model) =>
					model.provider === provider &&
					model.id.toLowerCase() === model_id.toLowerCase(),
			);
			if (provider_match) return provider_match;
		}
	}

	return models.find((model) => {
		const id = model.id.toLowerCase();
		const full_id = `${model.provider}/${model.id}`.toLowerCase();
		return id === lower_reference || full_id === lower_reference;
	});
}

export function resolve_effective_thinking_level(
	model: Model<Api> | undefined,
	thinking: MyPiThinkingLevel | undefined,
): MyPiThinkingLevel | undefined {
	if (!thinking || !model) return thinking;
	return clampThinkingLevel(model, thinking);
}
