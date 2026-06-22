import { describe, expectTypeOf, it } from 'vitest';
import type { Server } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import type {
	ObservabilityServerOptions,
	RunningObservabilityServer,
} from './server-options.js';

describe('observability server option types', () => {
	it('describes server startup inputs and returned handles', () => {
		expectTypeOf<ObservabilityServerOptions>().toExtend<{
			host: string;
			port: number;
			token: string;
			db_path: string;
			log: boolean;
			retention_days?: number;
			max_events?: number;
		}>();
		expectTypeOf<RunningObservabilityServer>().toExtend<{
			server: Server;
			db: DatabaseSync;
			url: string;
			db_path: string;
			close: () => Promise<void>;
		}>();
	});
});
