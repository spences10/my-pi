import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ObservabilityConfig } from './index.js';

describe('public observability types', () => {
	it('accepts configuration objects from before session forwarding', () => {
		const legacy_config: ObservabilityConfig = {
			server_url: 'http://127.0.0.1:43190',
			pool: 'default',
			tags: [],
			raw_payloads: false,
			detail_level: 'detailed',
			max_payload_bytes: 32_768,
			auto_start_server: true,
		};

		expectTypeOf<
			typeof legacy_config
		>().toExtend<ObservabilityConfig>();
	});

	it('emits downstream compatibility declarations', () => {
		const tsc = fileURLToPath(
			new URL(
				'../node_modules/typescript/lib/tsc.js',
				import.meta.url,
			),
		);
		const project = fileURLToPath(
			new URL('../tsconfig.compatibility.json', import.meta.url),
		);

		expect(() =>
			execFileSync(process.execPath, [tsc, '--project', project], {
				stdio: 'pipe',
			}),
		).not.toThrow();
	});
});
