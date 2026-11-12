import * as v from 'valibot';

/** What `JSON.parse` can produce. */
export type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

/**
 * A JSON value that may also be `undefined`, as found in in-process
 * event payloads before they are serialised.
 */
export type PayloadValue =
	| undefined
	| null
	| boolean
	| number
	| string
	| PayloadValue[]
	| { [key: string]: PayloadValue };

/** An event payload object whose fields are payload values. */
export type PayloadObject = { [key: string]: PayloadValue };

export const json_value_schema: v.GenericSchema<unknown, JsonValue> =
	v.lazy(() =>
		v.union([
			v.null(),
			v.boolean(),
			v.number(),
			v.string(),
			v.array(json_value_schema),
			v.record(v.string(), json_value_schema),
		]),
	);

/** A JSON object whose fields are JSON values. */
export type JsonObject = { [key: string]: JsonValue };

const json_scalar_schema = v.union([
	v.string(),
	v.number(),
	v.boolean(),
]);

const optional_string_schema = v.fallback(
	v.optional(v.string()),
	undefined,
);

const optional_number_schema = v.fallback(
	v.optional(v.number()),
	undefined,
);

/** The value when it is a string, otherwise undefined. */
export function json_string(
	value: PayloadValue | undefined,
): string | undefined {
	return v.parse(optional_string_schema, value);
}

/** The value when it is a number, otherwise undefined. */
export function json_number(
	value: PayloadValue | undefined,
): number | undefined {
	return v.parse(optional_number_schema, value);
}

/** Whether the value is a string, number or boolean. */
export function is_json_scalar(
	value: PayloadValue,
): value is string | number | boolean {
	return v.is(json_scalar_schema, value);
}

/** The fields of a JSON object; undefined for null, scalars and arrays. */
export function json_object(
	value: JsonValue | undefined,
): JsonObject | undefined {
	if (
		value === null ||
		value === undefined ||
		Array.isArray(value) ||
		is_json_scalar(value)
	)
		return undefined;

	return value;
}

/** The fields of a payload object; undefined for null, scalars and arrays. */
export function payload_object(
	value: PayloadValue,
): PayloadObject | undefined {
	if (
		value === null ||
		value === undefined ||
		Array.isArray(value) ||
		is_json_scalar(value)
	)
		return undefined;

	return value;
}
