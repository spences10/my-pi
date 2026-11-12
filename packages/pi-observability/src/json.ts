import * as v from 'valibot';

/** What `JSON.parse` can produce. */
export type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

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
