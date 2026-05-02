import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
import {
	resolve_project_trust,
	type ProjectTrustSubject,
} from '@spences10/pi-project-trust';
import {
	get_project_mcp_config_info,
	type McpProjectConfigInfo,
} from './config.js';
import {
	create_mcp_project_trust_subject,
	default_mcp_trust_store_path,
	is_project_mcp_config_trusted,
} from './trust.js';

const PROJECT_MCP_CONFIG_ENV = 'MY_PI_MCP_PROJECT_CONFIG';

export interface ProjectMcpConfigLoadDecision {
	include_project: boolean;
	metadata_trusted: boolean;
}

function create_project_mcp_trust_subject(
	info: McpProjectConfigInfo,
): ProjectTrustSubject {
	const server_lines =
		info.servers.length === 0
			? ['- no valid server entries detected']
			: info.servers.map(
					(server) => `- ${server.name}: ${server.summary}`,
				);
	return {
		...create_mcp_project_trust_subject(info.path, info.hash),
		summary_lines: server_lines,
		choices: {
			allow_once: 'Allow once for this session',
			trust: 'Trust this repo until mcp.json changes',
			skip: 'Skip project MCP config',
		},
		headless_warning: `Skipping untrusted project MCP config: ${info.path}. Set ${PROJECT_MCP_CONFIG_ENV}=allow to enable it for this run.`,
	};
}

export async function get_project_mcp_config_load_decision(
	cwd: string,
	ctx?: ExtensionContext,
): Promise<ProjectMcpConfigLoadDecision> {
	const skipped = { include_project: false, metadata_trusted: false };
	const info = get_project_mcp_config_info(cwd);
	if (!info) return skipped;
	if (process.env[PROJECT_MCP_CONFIG_ENV] === 'allow') {
		return { include_project: true, metadata_trusted: false };
	}
	if (is_project_mcp_config_trusted(info.path, info.hash)) {
		return { include_project: true, metadata_trusted: true };
	}
	const decision = await resolve_project_trust(
		create_project_mcp_trust_subject(info),
		{
			env: process.env,
			has_ui: ctx?.hasUI,
			select: ctx?.hasUI
				? async (message, choices) =>
						(await ctx.ui.select(message, choices)) ?? ''
				: undefined,
			warn: console.warn,
			trust_store_path: default_mcp_trust_store_path(),
		},
	);
	return {
		include_project:
			decision.action === 'allow-once' ||
			decision.action === 'trust-persisted',
		metadata_trusted: decision.action === 'trust-persisted',
	};
}
