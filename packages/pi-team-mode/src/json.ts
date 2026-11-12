import * as v from 'valibot';

/** What `JSON.parse` can produce. */
export type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

export type JsonRecord = Record<string, JsonValue>;

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

export const json_record_schema: v.GenericSchema<
	unknown,
	JsonRecord
> = v.record(v.string(), json_value_schema);

const optional_text_schema = v.fallback(
	v.optional(v.string()),
	undefined,
);

/** The string stored under a metadata key, or undefined when absent or not text. */
export function metadata_text(
	metadata: JsonRecord,
	key: string,
): string | undefined {
	return v.parse(optional_text_schema, metadata[key]);
}
