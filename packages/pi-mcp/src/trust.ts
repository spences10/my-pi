import {
	create_project_trust_wrapper,
	type ProjectTrustSubject,
} from '@spences10/pi-project-trust';

const MCP_PROJECT_CONFIG_ENV = 'MY_PI_MCP_PROJECT_CONFIG';

const mcp_project_trust = create_project_trust_wrapper({
	store_filename: 'trusted-mcp-projects.json',
	legacy_matcher: (entry, subject) => {
		const legacy_entry = entry as
			| { path?: unknown; hash?: unknown }
			| undefined;
		return (
			legacy_entry?.path === subject.id &&
			legacy_entry.hash === subject.hash
		);
	},
});

export function default_mcp_trust_store_path(): string {
	return mcp_project_trust.default_trust_store_path();
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
	return mcp_project_trust.is_trusted(
		create_mcp_project_trust_subject(path, hash),
		trust_store_path,
	);
}

export function trust_project_mcp_config(
	path: string,
	hash: string,
	trust_store_path = default_mcp_trust_store_path(),
): void {
	mcp_project_trust.trust(
		create_mcp_project_trust_subject(path, hash),
		trust_store_path,
	);
}
