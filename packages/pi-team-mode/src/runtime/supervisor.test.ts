import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TeamDatabase } from '../db/index.js';
import { shutdown_runtime } from './client.js';
import { start_persistent_runtime } from './supervisor.js';

const dirs: string[] = [];

async function setup() {
	const root = mkdtempSync(join(tmpdir(), 'pi-runtime-supervisor-'));
	dirs.push(root);
	const db_path = join(root, 'coordination.db');
	const session_file = join(root, 'session.jsonl');
	const db = await TeamDatabase.open(db_path);
	db.register_session({
		session_id: 'teammate-session',
		session_file,
		cwd: root,
		status: 'offline',
	});
	db.close();
	return { root, db_path, session_file };
}

async function wait_for_failed(db_path: string) {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		const db = await TeamDatabase.open(db_path);
		const runtime = db.get_session_runtime('teammate-session');
		db.close();
		if (runtime?.state === 'failed') return runtime;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error('runtime did not enter failed state');
}

function write_host(root: string, source: string): string {
	const path = join(root, 'runtime-host.mjs');
	writeFileSync(path, source);
	return path;
}

const CRASHING_READY_HOST = String.raw`
import { readFileSync, rmSync, rmdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
const config_path = process.argv[process.argv.indexOf('--config-file') + 1];
const config = JSON.parse(Buffer.from(readFileSync(config_path, 'utf8'), 'base64url').toString('utf8'));
rmSync(config_path);
rmdirSync(dirname(config_path));
const db = new DatabaseSync(config.db_path);
const now = new Date().toISOString();
const lease = new Date(Date.now() + 30_000).toISOString();
const runtime = {
  session_id: config.session_id,
  runtime_id: config.runtime_id,
  generation: config.generation,
  pid: process.pid,
  endpoint: config.endpoint,
  state: 'ready',
  autonomous: true,
  lease_expires_at: lease,
  ready_at: now,
  diagnostics: [],
  created_at: now,
  updated_at: now
};
const server = createServer((socket) => {
  let body = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    body += chunk;
    if (!body.includes('\n')) return;
    const request = JSON.parse(body.slice(0, body.indexOf('\n')));
    socket.end(JSON.stringify({ id: request.id, version: 1, ok: true, runtime }) + '\n');
  });
});
server.listen(config.endpoint, () => {
  db.prepare("UPDATE session_runtimes SET pid = ?, process_identity_json = '{}', state = 'ready', heartbeat_at = ?, lease_expires_at = ?, ready_at = ?, updated_at = ? WHERE session_id = ? AND runtime_id = ? AND generation = ?")
    .run(process.pid, now, lease, now, now, config.session_id, config.runtime_id, config.generation);
  setTimeout(() => {
    console.error(['API', 'KEY'].join('_') + '=' + ['runtime', 'value'].join('-'));
    process.exit(23);
  }, 300);
});
`;

const CONTROLLED_READY_HOST = String.raw`
import { readFileSync, rmSync, rmdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
const config_path = process.argv[process.argv.indexOf('--config-file') + 1];
const config = JSON.parse(Buffer.from(readFileSync(config_path, 'utf8'), 'base64url').toString('utf8'));
rmSync(config_path);
rmdirSync(dirname(config_path));
const db = new DatabaseSync(config.db_path);
const now = new Date().toISOString();
const lease = new Date(Date.now() + 30_000).toISOString();
function runtime(state) {
  return {
    session_id: config.session_id,
    runtime_id: config.runtime_id,
    generation: config.generation,
    pid: process.pid,
    endpoint: config.endpoint,
    state,
    autonomous: true,
    lease_expires_at: lease,
    ready_at: now,
    diagnostics: [],
    created_at: now,
    updated_at: new Date().toISOString()
  };
}
const server = createServer((socket) => {
  let body = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    body += chunk;
    if (!body.includes('\n')) return;
    const request = JSON.parse(body.slice(0, body.indexOf('\n')));
    if (request.method === 'shutdown') {
      const stopped = new Date().toISOString();
      db.prepare("UPDATE session_runtimes SET state = 'offline', lease_expires_at = ?, stopped_at = ?, updated_at = ? WHERE session_id = ? AND runtime_id = ? AND generation = ?")
        .run(stopped, stopped, stopped, config.session_id, config.runtime_id, config.generation);
      socket.end(JSON.stringify({ id: request.id, version: 1, ok: true, runtime: runtime('offline') }) + '\n', () => {
        server.close(() => process.exit(0));
      });
      return;
    }
    socket.end(JSON.stringify({ id: request.id, version: 1, ok: true, runtime: runtime('ready') }) + '\n');
  });
});
server.listen(config.endpoint, () => {
  db.prepare("UPDATE session_runtimes SET pid = ?, process_identity_json = '{}', state = 'ready', heartbeat_at = ?, lease_expires_at = ?, ready_at = ?, updated_at = ? WHERE session_id = ? AND runtime_id = ? AND generation = ?")
    .run(process.pid, now, lease, now, now, config.session_id, config.runtime_id, config.generation);
});
`;

const NEVER_READY_HOST = String.raw`
import { readFileSync, rmSync, rmdirSync } from 'node:fs';
import { dirname } from 'node:path';
const config_path = process.argv[process.argv.indexOf('--config-file') + 1];
readFileSync(config_path, 'utf8');
rmSync(config_path);
rmdirSync(dirname(config_path));
setInterval(() => {}, 1_000);
`;

afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

describe('persistent runtime subprocess supervision', () => {
	it('records a ready runtime crash promptly with bounded redacted diagnostics', async () => {
		const { root, db_path, session_file } = await setup();
		const runtime = await start_persistent_runtime({
			db_path,
			session_id: 'teammate-session',
			session_file,
			cwd: root,
			host_module: write_host(root, CRASHING_READY_HOST),
			timeout_ms: 5_000,
		});
		expect(runtime.state).toBe('ready');

		const failed = await wait_for_failed(db_path);
		expect(failed).toMatchObject({
			state: 'failed',
			exit_code: 23,
		});
		expect(failed.error).toContain('code 23');
		expect(failed.diagnostics.join('\n')).toContain(
			'API_KEY=[REDACTED]',
		);
		expect(failed.diagnostics.join('\n')).not.toContain(
			['runtime', 'value'].join('-'),
		);
	}, 10_000);

	it('records forced termination by signal', async () => {
		const { root, db_path, session_file } = await setup();
		const runtime = await start_persistent_runtime({
			db_path,
			session_id: 'teammate-session',
			session_file,
			cwd: root,
			host_module: write_host(root, CONTROLLED_READY_HOST),
			timeout_ms: 5_000,
		});
		expect(runtime.pid).toBeDefined();
		process.kill(runtime.pid!, 'SIGKILL');

		const failed = await wait_for_failed(db_path);
		expect(failed).toMatchObject({
			state: 'failed',
			exit_signal: 'SIGKILL',
		});
	}, 10_000);

	it('turns a host crash before readiness into an immediate structured failure', async () => {
		const { root, db_path, session_file } = await setup();
		const missing_host = join(root, 'missing-runtime-host.mjs');

		await expect(
			start_persistent_runtime({
				db_path,
				session_id: 'teammate-session',
				session_file,
				cwd: root,
				host_module: missing_host,
				timeout_ms: 5_000,
			}),
		).rejects.toThrow(/Runtime host exited unexpectedly/);

		const failed = await wait_for_failed(db_path);
		expect(failed.state).toBe('failed');
		expect(failed.exit_code).not.toBeUndefined();
		expect(failed.diagnostics.join('\n')).toContain(
			'missing-runtime-host.mjs',
		);
	});

	it('recovers the same session generation and shuts it down gracefully', async () => {
		const { root, db_path, session_file } = await setup();
		await expect(
			start_persistent_runtime({
				db_path,
				session_id: 'teammate-session',
				session_file,
				cwd: root,
				host_module: join(root, 'missing-runtime-host.mjs'),
				timeout_ms: 5_000,
			}),
		).rejects.toThrow();
		await wait_for_failed(db_path);

		const recovered = await start_persistent_runtime({
			db_path,
			session_id: 'teammate-session',
			session_file,
			cwd: root,
			host_module: write_host(root, CONTROLLED_READY_HOST),
			timeout_ms: 5_000,
		});
		expect(recovered).toMatchObject({
			session_id: 'teammate-session',
			generation: 2,
			state: 'ready',
		});
		await expect(shutdown_runtime(recovered)).resolves.toMatchObject({
			state: 'offline',
		});

		const db = await TeamDatabase.open(db_path);
		expect(db.get_session_runtime('teammate-session')).toMatchObject({
			generation: 2,
			state: 'offline',
		});
		db.close();
	}, 10_000);

	it('terminates a host that never becomes ready and persists the timeout', async () => {
		const { root, db_path, session_file } = await setup();

		await expect(
			start_persistent_runtime({
				db_path,
				session_id: 'teammate-session',
				session_file,
				cwd: root,
				host_module: write_host(root, NEVER_READY_HOST),
				timeout_ms: 100,
			}),
		).rejects.toThrow('Timed out waiting for runtime readiness');

		const failed = await wait_for_failed(db_path);
		expect(failed.error).toContain('Runtime readiness failed');
		expect(failed.stopped_at).toBeDefined();
	});
});
