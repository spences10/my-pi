import {
	is_project_subject_trusted,
	read_project_trust_store,
	trust_project_subject,
	type ProjectTrustSubject,
} from '@spences10/pi-project-trust';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MCP_PROJECT_CONFIG_ENV = 'MY_PI_MCP_PROJECT_CONFIG';

export function default_mcp_trust_store_path(): string {
	return join(homedir(), '.pi', 'agent', 'trusted-mcp-projects.json');
}

export function create_mcp_project_trust_subject(
	path: string,
	hash: string,
): ProjectTrustSubject {
	return {
		kind: 'mcp-config',
		id: path,
		hash,
		store_key: path,
		env_key: MCP_PROJECT_CONFIG_ENV,
		prompt_title:
			'Project mcp.json can spawn local commands. Trust this config?',
	};
}

export function is_project_mcp_config_trusted(
	path: string,
	hash: string,
	trust_store_path = default_mcp_trust_store_path(),
): boolean {
	const subject = create_mcp_project_trust_subject(path, hash);
	if (is_project_subject_trusted(subject, trust_store_path))
		return true;

	const legacy_entry = read_project_trust_store(trust_store_path)[
		path
	] as { path?: string; hash?: string } | undefined;
	return legacy_entry?.path === path && legacy_entry.hash === hash;
}

export function trust_project_mcp_config(
	path: string,
	hash: string,
	trust_store_path = default_mcp_trust_store_path(),
): void {
	trust_project_subject(
		create_mcp_project_trust_subject(path, hash),
		trust_store_path,
	);
}
