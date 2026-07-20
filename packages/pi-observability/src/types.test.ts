import { describe, expectTypeOf, it } from 'vitest';
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
});
