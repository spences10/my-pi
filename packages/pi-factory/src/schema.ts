import { Type } from 'typebox';

export const factory_start_params_schema = Type.Object({
	harness_dir: Type.String({ minLength: 1 }),
	timeout_ms: Type.Optional(
		Type.Number({ minimum: 1, maximum: 3_600_000 }),
	),
});
