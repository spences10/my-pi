import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

interface TrustedHooksEntry {
	project_dir: string;
	hash: string;
	trusted_at: string;
}

type TrustedHooks = Record<string, TrustedHooksEntry>;

export function default_hooks_trust_store_path(): string {
	return join(homedir(), '.pi', 'agent', 'trusted-hooks.json');
}

export function is_hooks_config_trusted(
	project_dir: string,
	hash: string,
	trust_store_path = default_hooks_trust_store_path(),
): boolean {
	const trusted_hooks = read_trusted_hooks(trust_store_path);
	const entry = trusted_hooks[project_dir];
	return entry?.hash === hash;
}

export function trust_hooks_config(
	project_dir: string,
	hash: string,
	trust_store_path = default_hooks_trust_store_path(),
): void {
	const trusted_hooks = read_trusted_hooks(trust_store_path);
	trusted_hooks[project_dir] = {
		project_dir,
		hash,
		trusted_at: new Date().toISOString(),
	};
	mkdirSync(dirname(trust_store_path), { recursive: true });
	writeFileSync(
		trust_store_path,
		JSON.stringify(trusted_hooks, null, '\t') + '\n',
		{
			encoding: 'utf8',
			mode: 0o600,
		},
	);
}

function read_trusted_hooks(trust_store_path: string): TrustedHooks {
	if (!existsSync(trust_store_path)) return {};
	try {
		const raw = readFileSync(trust_store_path, 'utf-8');
		const parsed = JSON.parse(raw) as TrustedHooks;
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}
