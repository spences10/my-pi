import { randomUUID } from 'node:crypto';
import type {
	CoordinationSessionRuntime,
	RuntimeLifecycleState,
	TeamDatabase,
} from '../db/index.js';
import {
	default_process_identity_verifier,
	type ProcessIdentityVerifier,
	type TeamProcessIdentity,
	verify_process_identity,
} from '../process-identity.js';

export const DEFAULT_RUNTIME_LEASE_MS = 15_000;

const allowed_transitions: Record<
	RuntimeLifecycleState,
	RuntimeLifecycleState[]
> = {
	created: ['starting', 'offline', 'failed'],
	starting: [
		'ready',
		'idle',
		'running',
		'stopping',
		'offline',
		'failed',
	],
	ready: ['idle', 'running', 'stopping', 'offline', 'failed'],
	idle: [
		'running',
		'waiting',
		'blocked',
		'stopping',
		'offline',
		'failed',
	],
	running: [
		'idle',
		'waiting',
		'blocked',
		'stopping',
		'offline',
		'failed',
	],
	waiting: [
		'idle',
		'running',
		'blocked',
		'stopping',
		'offline',
		'failed',
	],
	blocked: [
		'idle',
		'running',
		'waiting',
		'stopping',
		'offline',
		'failed',
	],
	stopping: ['offline', 'failed'],
	offline: [],
	failed: ['offline'],
};

export class RuntimeOwnershipError extends Error {
	constructor(
		message: string,
		readonly runtime?: CoordinationSessionRuntime,
	) {
		super(message);
		this.name = 'RuntimeOwnershipError';
	}
}

function lease_expiry(now_ms: number, lease_ms: number): string {
	return new Date(now_ms + lease_ms).toISOString();
}

function persisted_identity(
	runtime: CoordinationSessionRuntime,
): TeamProcessIdentity | undefined {
	const value = runtime.process_identity;
	return value && typeof value.pid === 'number'
		? (value as unknown as TeamProcessIdentity)
		: undefined;
}

function original_owner_is_proven_dead(
	runtime: CoordinationSessionRuntime,
	verifier: ProcessIdentityVerifier,
): boolean {
	if (!runtime.pid) return true;
	if (!verifier.is_alive(runtime.pid)) return true;
	const verification = verify_process_identity(
		persisted_identity(runtime),
		verifier,
	);
	return verification.reason === 'process start identity changed';
}

export function reserve_runtime_ownership(
	db: TeamDatabase,
	options: {
		session_id: string;
		runtime_id?: string;
		endpoint: string;
		lease_ms?: number;
		now_ms?: number;
		autonomous?: boolean;
		control_owner?: string;
	},
	verifier: ProcessIdentityVerifier = default_process_identity_verifier,
): CoordinationSessionRuntime {
	const now_ms = options.now_ms ?? Date.now();
	const timestamp = new Date(now_ms).toISOString();
	const runtime_id = options.runtime_id ?? randomUUID();
	const write = {
		session_id: options.session_id,
		runtime_id,
		endpoint: options.endpoint,
		state: 'created' as const,
		autonomous: options.autonomous,
		control_owner: options.control_owner,
		lease_expires_at: lease_expiry(
			now_ms,
			options.lease_ms ?? DEFAULT_RUNTIME_LEASE_MS,
		),
	};
	const created = db.create_session_runtime(write);
	if (created) return created;

	const current = db.get_session_runtime(options.session_id);
	if (!current)
		throw new RuntimeOwnershipError(
			'Runtime ownership changed while reserving',
		);
	if (current.runtime_id === runtime_id) return current;
	if (Date.parse(current.lease_expires_at) > now_ms)
		throw new RuntimeOwnershipError(
			`Session runtime is owned by generation ${current.generation} with an active lease`,
			current,
		);
	if (!original_owner_is_proven_dead(current, verifier))
		throw new RuntimeOwnershipError(
			'Session runtime owner is still alive or its identity cannot be disproved',
			current,
		);

	const replaced = db.replace_session_runtime(
		write,
		current.generation,
		timestamp,
	);
	if (!replaced)
		throw new RuntimeOwnershipError(
			'Runtime ownership changed during recovery',
			db.get_session_runtime(options.session_id),
		);
	return replaced;
}

export function adopt_runtime_ownership(
	db: TeamDatabase,
	options: {
		session_id: string;
		runtime_id: string;
		generation: number;
		endpoint: string;
		pid?: number;
		lease_ms?: number;
		now_ms?: number;
		diagnostics?: string[];
	},
	verifier: ProcessIdentityVerifier = default_process_identity_verifier,
): CoordinationSessionRuntime {
	const pid = options.pid ?? process.pid;
	const identity = verifier.capture(pid, {
		marker: options.runtime_id,
	});
	if (!identity?.start_key)
		throw new RuntimeOwnershipError(
			'Cannot own a session runtime without a stable process start identity',
		);
	const now_ms = options.now_ms ?? Date.now();
	const timestamp = new Date(now_ms).toISOString();
	const adopted = db.adopt_session_runtime({
		session_id: options.session_id,
		runtime_id: options.runtime_id,
		generation: options.generation,
		pid,
		process_identity: identity as unknown as Record<string, unknown>,
		endpoint: options.endpoint,
		state: 'starting',
		heartbeat_at: timestamp,
		lease_expires_at: lease_expiry(
			now_ms,
			options.lease_ms ?? DEFAULT_RUNTIME_LEASE_MS,
		),
		diagnostics: options.diagnostics,
	});
	if (!adopted)
		throw new RuntimeOwnershipError(
			'Runtime reservation is no longer owned by this process',
			db.get_session_runtime(options.session_id),
		);
	return adopted;
}

export function assert_runtime_owner(
	db: TeamDatabase,
	options: {
		session_id: string;
		runtime_id: string;
		generation: number;
		pid?: number;
	},
	verifier: ProcessIdentityVerifier = default_process_identity_verifier,
): CoordinationSessionRuntime {
	const runtime = db.get_session_runtime(options.session_id);
	if (
		!runtime ||
		runtime.runtime_id !== options.runtime_id ||
		runtime.generation !== options.generation ||
		runtime.pid !== (options.pid ?? process.pid)
	)
		throw new RuntimeOwnershipError(
			'Runtime generation is no longer the session owner',
			runtime,
		);
	const verification = verify_process_identity(
		persisted_identity(runtime),
		verifier,
	);
	if (!verification.ok)
		throw new RuntimeOwnershipError(
			`Runtime process identity check failed: ${verification.reason}`,
			runtime,
		);
	return runtime;
}

export function heartbeat_runtime_ownership(
	db: TeamDatabase,
	options: {
		session_id: string;
		runtime_id: string;
		generation: number;
		pid?: number;
		lease_ms?: number;
		now_ms?: number;
	},
	verifier: ProcessIdentityVerifier = default_process_identity_verifier,
): CoordinationSessionRuntime {
	assert_runtime_owner(db, options, verifier);
	const now_ms = options.now_ms ?? Date.now();
	const heartbeat_at = new Date(now_ms).toISOString();
	const updated = db.heartbeat_session_runtime({
		session_id: options.session_id,
		runtime_id: options.runtime_id,
		generation: options.generation,
		heartbeat_at,
		lease_expires_at: lease_expiry(
			now_ms,
			options.lease_ms ?? DEFAULT_RUNTIME_LEASE_MS,
		),
	});
	if (!updated)
		throw new RuntimeOwnershipError(
			'Runtime lost ownership while heartbeating',
		);
	return db.get_session_runtime(options.session_id)!;
}

export function transition_runtime(
	db: TeamDatabase,
	options: {
		session_id: string;
		runtime_id: string;
		generation: number;
		state: RuntimeLifecycleState;
		lease_ms?: number;
		now_ms?: number;
		error?: string;
		diagnostics?: string[];
		exit_code?: number;
		exit_signal?: string;
		data?: Record<string, unknown>;
	},
): CoordinationSessionRuntime {
	const current = db.get_session_runtime(options.session_id);
	if (
		!current ||
		current.runtime_id !== options.runtime_id ||
		current.generation !== options.generation
	)
		throw new RuntimeOwnershipError(
			'Runtime generation is no longer the session owner',
			current,
		);
	if (
		current.state !== options.state &&
		!allowed_transitions[current.state].includes(options.state)
	)
		throw new Error(
			`Invalid runtime state transition ${current.state} -> ${options.state}`,
		);
	const now_ms = options.now_ms ?? Date.now();
	const terminal =
		options.state === 'offline' || options.state === 'failed';
	const timestamp = new Date(now_ms).toISOString();
	const updated = db.transition_session_runtime({
		session_id: options.session_id,
		runtime_id: options.runtime_id,
		generation: options.generation,
		state: options.state,
		lease_expires_at: terminal
			? timestamp
			: lease_expiry(
					now_ms,
					options.lease_ms ?? DEFAULT_RUNTIME_LEASE_MS,
				),
		ready_at:
			!current.ready_at &&
			(options.state === 'ready' || options.state === 'idle')
				? timestamp
				: undefined,
		stopped_at: terminal ? timestamp : undefined,
		error: options.error,
		diagnostics: options.diagnostics,
		exit_code: options.exit_code,
		exit_signal: options.exit_signal,
		data: options.data,
	});
	if (!updated)
		throw new RuntimeOwnershipError(
			'Runtime lost ownership while changing state',
		);
	return db.get_session_runtime(options.session_id)!;
}
