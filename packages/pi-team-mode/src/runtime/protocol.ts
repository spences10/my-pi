import type {
	CoordinationSessionRuntime,
	RuntimeLifecycleState,
} from '../db/index.js';

export const TEAM_RUNTIME_PROTOCOL_VERSION = 1 as const;

export type RuntimeRequest =
	| { id: string; version: 1; method: 'status' }
	| {
			id: string;
			version: 1;
			method: 'prompt' | 'steer' | 'follow_up';
			message: string;
	  }
	| { id: string; version: 1; method: 'abort' | 'shutdown' };

export type RuntimeResponse =
	| {
			id: string;
			version: 1;
			ok: true;
			runtime: CoordinationSessionRuntime;
	  }
	| {
			id: string;
			version: 1;
			ok: false;
			error: string;
			state?: RuntimeLifecycleState;
	  };

export interface RuntimeHostConfig {
	db_path: string;
	session_id: string;
	session_file: string;
	cwd: string;
	runtime_id: string;
	generation: number;
	endpoint: string;
	extension_path: string;
	member?: string;
	role?: 'lead' | 'teammate' | 'peer';
	from_session_id?: string;
	report_to_session_ids?: string[];
	lease_ms?: number;
	heartbeat_ms?: number;
}

export function parse_runtime_request(
	value: unknown,
): RuntimeRequest {
	if (!value || typeof value !== 'object')
		throw new Error('Runtime request must be an object');
	const request = value as Record<string, unknown>;
	if (request.version !== TEAM_RUNTIME_PROTOCOL_VERSION)
		throw new Error('Unsupported runtime protocol version');
	if (typeof request.id !== 'string' || !request.id)
		throw new Error('Runtime request id is required');
	const method = request.method;
	if (
		method !== 'status' &&
		method !== 'prompt' &&
		method !== 'steer' &&
		method !== 'follow_up' &&
		method !== 'abort' &&
		method !== 'shutdown'
	)
		throw new Error('Unsupported runtime method');
	if (
		(method === 'prompt' ||
			method === 'steer' ||
			method === 'follow_up') &&
		(typeof request.message !== 'string' || !request.message.trim())
	)
		throw new Error('Runtime message is required');
	return request as RuntimeRequest;
}
