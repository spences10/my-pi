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
