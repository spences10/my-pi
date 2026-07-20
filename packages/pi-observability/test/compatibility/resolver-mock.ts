import {
	resolve_observability_config,
	type ObservabilityConfig,
} from '../../src/index.js';

const legacy_config: ObservabilityConfig = {
	server_url: 'http://127.0.0.1:43190',
	pool: 'default',
	tags: [],
	raw_payloads: false,
	detail_level: 'detailed',
	max_payload_bytes: 32_768,
	auto_start_server: true,
};

export const legacy_resolver: typeof resolve_observability_config =
	() => legacy_config;
