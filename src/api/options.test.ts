import { describe, expectTypeOf, it } from 'vitest';
import type {
	BuiltinExtensionOptions,
	CreateMyPiOptions,
	MyPiRuntimeMode,
} from './options.js';

describe('api option types', () => {
	it('accepts supported runtime modes and built-in flags', () => {
		expectTypeOf<MyPiRuntimeMode>().toEqualTypeOf<
			'interactive' | 'print' | 'json' | 'rpc'
		>();
		expectTypeOf<CreateMyPiOptions>().toExtend<{
			cwd?: string;
			extension_flag_values?: Map<string, boolean | string>;
			runtime_mode?: MyPiRuntimeMode;
			telemetry?: boolean;
			untrusted_repo?: boolean;
		}>();
		expectTypeOf<CreateMyPiOptions>().toExtend<BuiltinExtensionOptions>();
	});
});
