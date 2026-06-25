import {
	clampThinkingLevel,
	type Api,
	type Model,
} from '@earendil-works/pi-ai';
import type { TeamThinkingLevel } from './command-parser.js';

interface ModelRegistryLike {
	getAll(): Model<Api>[];
}

export interface TeammateModelSelectionInput {
	requested_model?: string;
	profile_model?: string;
	current_model?: Model<Api>;
	model_registry?: ModelRegistryLike;
	requested_thinking?: TeamThinkingLevel;
	profile_thinking?: string;
}

export interface TeammateModelSelection {
	model?: string;
	thinking?: string;
}

function resolve_model_reference(
	model_reference: string,
	model_registry: ModelRegistryLike,
): Model<Api> | undefined {
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

function model_reference(model: Model<Api>): string {
	return `${model.provider}/${model.id}`;
}

export function select_teammate_model_config({
	requested_model,
	profile_model,
	current_model,
	model_registry,
	requested_thinking,
	profile_thinking,
}: TeammateModelSelectionInput): TeammateModelSelection {
	const model_source = requested_model ?? profile_model;
	const resolved_model =
		model_source && model_registry
			? resolve_model_reference(model_source, model_registry)
			: undefined;
	if (model_source && model_registry && !resolved_model) {
		throw new Error(`Model is not available: ${model_source}`);
	}
	const model = resolved_model
		? model_reference(resolved_model)
		: (model_source ??
			(current_model ? model_reference(current_model) : undefined));
	const thinking = requested_thinking ?? profile_thinking;
	const thinking_model = resolved_model ?? current_model;
	return {
		model,
		thinking:
			thinking && thinking_model
				? clampThinkingLevel(thinking_model, thinking as any)
				: thinking,
	};
}
