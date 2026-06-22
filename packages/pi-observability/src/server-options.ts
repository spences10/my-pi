import type { Server } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';

export interface ObservabilityServerOptions {
	host: string;
	port: number;
	token: string;
	db_path: string;
	log: boolean;
	retention_days?: number;
	max_events?: number;
}

export interface RunningObservabilityServer {
	server: Server;
	db: DatabaseSync;
	url: string;
	db_path: string;
	close: () => Promise<void>;
}
