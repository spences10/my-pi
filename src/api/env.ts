import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { apply_project_trust_untrusted_defaults } from '@spences10/pi-project-trust';
import { resolve } from 'node:path';

export const PI_AGENT_DIR_ENV = 'PI_CODING_AGENT_DIR';
export const MY_PI_RUNTIME_MODE_ENV = 'MY_PI_RUNTIME_MODE';

type EnvSnapshot = Map<string, string | undefined>;

export function snapshot_env(
	env: NodeJS.ProcessEnv,
	keys: Iterable<string>,
): EnvSnapshot {
	return new Map(Array.from(keys, (key) => [key, env[key]]));
}

export function restore_env(
	env: NodeJS.ProcessEnv,
	snapshot: EnvSnapshot,
): void {
	for (const [key, value] of snapshot) {
		if (value === undefined) delete env[key];
		else env[key] = value;
	}
}

export function wrap_runtime_env_restore<
	T extends { dispose(): Promise<void> },
>(runtime: T, restore: () => void): T {
	const dispose = runtime.dispose.bind(runtime);
	let restored = false;
	const restore_once = () => {
		if (restored) return;
		restored = true;
		restore();
	};

	runtime.dispose = (async () => {
		try {
			await dispose();
		} finally {
			restore_once();
		}
	}) as T['dispose'];

	return runtime;
}

const UNTRUSTED_CHILD_ENV_DEFAULTS: Record<string, string> = {
	MY_PI_CHILD_ENV_ALLOWLIST: '',
	MY_PI_MCP_ENV_ALLOWLIST: '',
	MY_PI_LSP_ENV_ALLOWLIST: '',
	MY_PI_HOOKS_ENV_ALLOWLIST: '',
	MY_PI_TEAM_MODE_ENV_ALLOWLIST: '',
};

export function apply_untrusted_repo_defaults(
	env: NodeJS.ProcessEnv = process.env,
): string[] {
	const applied = apply_project_trust_untrusted_defaults(env);
	for (const [key, value] of Object.entries(
		UNTRUSTED_CHILD_ENV_DEFAULTS,
	)) {
		if (env[key] !== undefined) continue;
		env[key] = value;
		applied.push(key);
	}
	return applied;
}

export function is_resource_enabled(
	value: string | undefined,
): boolean {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) return true;
	if (['0', 'false', 'no', 'skip', 'disable'].includes(normalized)) {
		return false;
	}
	return true;
}

export function resolve_agent_dir(
	cwd: string,
	agent_dir?: string,
): string {
	return agent_dir ? resolve(cwd, agent_dir) : getAgentDir();
}
