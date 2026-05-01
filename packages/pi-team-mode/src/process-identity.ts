import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readlinkSync } from 'node:fs';

export interface TeamProcessIdentity {
	pid: number;
	platform: NodeJS.Platform;
	captured_at: string;
	start_key?: string;
	command?: string;
	cwd?: string;
	session_dir?: string;
	marker?: string;
}

export interface ProcessIdentityExpectation {
	session_dir?: string;
	marker?: string;
}

export interface ProcessIdentityVerifier {
	capture(
		pid: number,
		expectation?: ProcessIdentityExpectation,
	): TeamProcessIdentity | undefined;
	is_alive(pid: number | undefined): boolean;
	kill(pid: number, signal: NodeJS.Signals): void;
}

export interface ProcessIdentityVerification {
	ok: boolean;
	reason?: string;
	current?: TeamProcessIdentity;
}

export function is_pid_alive(pid: number | undefined): boolean {
	if (!pid || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function linux_stat_start_key(pid: number): string | undefined {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
		const end = stat.lastIndexOf(')');
		if (end === -1) return undefined;
		const fields = stat
			.slice(end + 2)
			.trim()
			.split(/\s+/);
		const start_ticks = fields[19];
		return start_ticks
			? `linux-start-ticks:${start_ticks}`
			: undefined;
	} catch {
		return undefined;
	}
}

function linux_command(pid: number): string | undefined {
	try {
		const command = readFileSync(`/proc/${pid}/cmdline`, 'utf8')
			.split('\0')
			.filter(Boolean)
			.join(' ')
			.trim();
		return command || undefined;
	} catch {
		return undefined;
	}
}

function linux_cwd(pid: number): string | undefined {
	try {
		return readlinkSync(`/proc/${pid}/cwd`);
	} catch {
		return undefined;
	}
}

function ps_identity(
	pid: number,
): Pick<TeamProcessIdentity, 'start_key' | 'command'> {
	try {
		const started = execFileSync(
			'ps',
			['-p', String(pid), '-o', 'lstart='],
			{
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore'],
			},
		).trim();
		const command = execFileSync(
			'ps',
			['-p', String(pid), '-o', 'command='],
			{
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore'],
			},
		).trim();
		return {
			start_key: started
				? `${process.platform}-lstart:${started}`
				: undefined,
			command: command || undefined,
		};
	} catch {
		return {};
	}
}

export function capture_process_identity(
	pid: number,
	expectation: ProcessIdentityExpectation = {},
): TeamProcessIdentity | undefined {
	if (!is_pid_alive(pid)) return undefined;
	const platform = process.platform;
	let start_key: string | undefined;
	let command: string | undefined;
	let cwd: string | undefined;
	if (platform === 'linux' && existsSync(`/proc/${pid}`)) {
		start_key = linux_stat_start_key(pid);
		command = linux_command(pid);
		cwd = linux_cwd(pid);
	} else {
		const ps = ps_identity(pid);
		start_key = ps.start_key;
		command = ps.command;
	}
	return {
		pid,
		platform,
		captured_at: new Date().toISOString(),
		...(start_key ? { start_key } : {}),
		...(command ? { command } : {}),
		...(cwd ? { cwd } : {}),
		...(expectation.session_dir
			? { session_dir: expectation.session_dir }
			: {}),
		...(expectation.marker ? { marker: expectation.marker } : {}),
	};
}

export const default_process_identity_verifier: ProcessIdentityVerifier =
	{
		capture: capture_process_identity,
		is_alive: is_pid_alive,
		kill: (pid, signal) => process.kill(pid, signal),
	};

function command_includes(
	command: string | undefined,
	value: string | undefined,
): boolean {
	return Boolean(command && value && command.includes(value));
}

export function verify_process_identity(
	persisted: TeamProcessIdentity | undefined,
	verifier: ProcessIdentityVerifier = default_process_identity_verifier,
): ProcessIdentityVerification {
	if (!persisted?.pid) {
		return {
			ok: false,
			reason: 'missing persisted process identity',
		};
	}
	if (!verifier.is_alive(persisted.pid)) {
		return { ok: false, reason: 'process is not running' };
	}
	const current = verifier.capture(persisted.pid, {
		session_dir: persisted.session_dir,
		marker: persisted.marker,
	});
	if (!current)
		return { ok: false, reason: 'process identity unavailable' };
	if (!persisted.start_key || !current.start_key) {
		return {
			ok: false,
			reason: 'process start identity unavailable on this platform',
			current,
		};
	}
	if (persisted.start_key !== current.start_key) {
		return {
			ok: false,
			reason: 'process start identity changed',
			current,
		};
	}
	if (
		persisted.session_dir &&
		current.command &&
		!command_includes(current.command, persisted.session_dir)
	) {
		return {
			ok: false,
			reason:
				'process command no longer references teammate session directory',
			current,
		};
	}
	if (
		persisted.marker &&
		current.command &&
		!command_includes(current.command, persisted.marker)
	) {
		return {
			ok: false,
			reason: 'process command no longer contains teammate marker',
			current,
		};
	}
	return { ok: true, current };
}
