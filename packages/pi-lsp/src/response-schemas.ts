import * as v from 'valibot';
import type { LspDocumentSymbol } from './client.js';

const position_schema = v.object({
	line: v.number(),
	character: v.number(),
});

const range_schema = v.object({
	start: position_schema,
	end: position_schema,
});

const location_schema = v.looseObject({
	uri: v.string(),
	range: range_schema,
});

const location_link_schema = v.looseObject({
	targetUri: v.string(),
	targetRange: range_schema,
	targetSelectionRange: v.optional(range_schema),
	originSelectionRange: v.optional(range_schema),
});

const marked_string_schema = v.union([
	v.string(),
	v.looseObject({
		value: v.string(),
		language: v.optional(v.string()),
	}),
	v.looseObject({ kind: v.string(), value: v.string() }),
]);

export const initialize_result_schema = v.nullish(
	v.looseObject({
		capabilities: v.optional(
			v.looseObject({ diagnosticProvider: v.optional(v.unknown()) }),
		),
	}),
);

export const hover_result_schema = v.nullish(
	v.looseObject({
		contents: v.union([
			marked_string_schema,
			v.array(marked_string_schema),
		]),
		range: v.optional(range_schema),
	}),
);

export const definition_result_schema = v.nullish(
	v.union([
		location_schema,
		location_link_schema,
		v.array(location_schema),
		v.array(location_link_schema),
	]),
);

export const references_result_schema = v.nullish(
	v.array(location_schema),
);

const document_symbol_schema: v.GenericSchema<LspDocumentSymbol> =
	v.lazy(() =>
		v.looseObject({
			name: v.string(),
			kind: v.number(),
			detail: v.optional(v.string()),
			range: range_schema,
			selectionRange: range_schema,
			children: v.optional(v.array(document_symbol_schema)),
			uri: v.optional(v.string()),
			containerName: v.optional(v.string()),
		}),
	);

const symbol_information_schema = v.looseObject({
	name: v.string(),
	kind: v.number(),
	location: location_schema,
	containerName: v.optional(v.string()),
});

export const document_symbols_result_schema = v.nullish(
	v.union([
		v.array(document_symbol_schema),
		v.array(symbol_information_schema),
	]),
);

const diagnostic_schema = v.looseObject({
	range: range_schema,
	severity: v.optional(
		v.union([v.literal(1), v.literal(2), v.literal(3), v.literal(4)]),
	),
	code: v.optional(v.union([v.string(), v.number()])),
	source: v.optional(v.string()),
	message: v.string(),
});

export const diagnostic_result_schema = v.nullish(
	v.looseObject({
		items: v.optional(v.array(diagnostic_schema)),
	}),
);

export const publish_diagnostics_params_schema = v.looseObject({
	uri: v.string(),
	version: v.nullish(v.number()),
	diagnostics: v.array(diagnostic_schema),
});

export const json_rpc_message_schema = v.looseObject({
	jsonrpc: v.optional(v.string()),
	id: v.optional(v.union([v.number(), v.string()])),
	method: v.optional(v.string()),
	params: v.optional(v.unknown()),
	result: v.optional(v.unknown()),
	error: v.optional(
		v.looseObject({
			code: v.number(),
			message: v.string(),
			data: v.optional(v.unknown()),
		}),
	),
});

/** A hover item reduced to its text: plain strings and `{ value }` objects. */
export const marked_string_text_schema = v.fallback(
	v.union([
		v.string(),
		v.pipe(
			v.looseObject({ value: v.optional(v.string()) }),
			v.transform((item) => item.value ?? ''),
		),
	]),
	'',
);

/** Anything carrying a string `code`, such as a Node system error. */
export const coded_error_schema = v.looseObject({ code: v.string() });
