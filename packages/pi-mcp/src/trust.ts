import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

interface TrustedMcpProjectEntry {
	path: string;
	hash: string;
	trusted_at: string;
}

type TrustedMcpProjects = Record<string, TrustedMcpProjectEntry>;

export function default_mcp_trust_store_path(): string {
	return join(homedir(), '.pi', 'agent', 'trusted-mcp-projects.json');
}

export function is_project_mcp_config_trusted(
	path: string,
	hash: string,
	trust_store_path = default_mcp_trust_store_path(),
): boolean {
	const trusted_projects = read_trusted_projects(trust_store_path);
	const entry = trusted_projects[path];
	return entry?.hash === hash;
}

export function trust_project_mcp_config(
	path: string,
	hash: string,
	trust_store_path = default_mcp_trust_store_path(),
): void {
	const trusted_projects = read_trusted_projects(trust_store_path);
	trusted_projects[path] = {
		path,
		hash,
		trusted_at: new Date().toISOString(),
	};
	mkdirSync(dirname(trust_store_path), { recursive: true });
	writeFileSync(
		trust_store_path,
		JSON.stringify(trusted_projects, null, '\t') + '\n',
		{ encoding: 'utf8', mode: 0o600 },
	);
}

function read_trusted_projects(
	trust_store_path: string,
): TrustedMcpProjects {
	if (!existsSync(trust_store_path)) return {};
	try {
		const raw = readFileSync(trust_store_path, 'utf-8');
		const parsed = JSON.parse(raw) as TrustedMcpProjects;
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}
