import type {
	BuildSystemPromptOptions,
	ExtensionAPI,
} from '@earendil-works/pi-coding-agent';

type Tool = Pick<
	ReturnType<ExtensionAPI['getAllTools']>[number],
	'name' | 'exposure' | 'namespace'
>;

const NOPEEK_GUIDANCE = `## Secret-safe commands
Never read secret files or print credential values into model context. Read the bundled my-pi-nopeek skill before credential-dependent commands. Use one-shot nopeek run with only the required keys; separate Pi shells do not share loaded environment changes. Child-process output can still leak secrets; redaction is best-effort, not a guarantee.`;

const OMNISEARCH_GUIDANCE = `## Web research
For research and current external facts, prefer the configured Omnisearch MCP server. Read the bundled my-pi-omnisearch skill. Discover its actual tools with tool search or codemode, and read source content before presenting claims; snippets alone are not verification.`;

const SQLITE_GUIDANCE = `## SQLite databases
Prefer the configured SQLite MCP tools over ad-hoc shell SQL. Read the bundled my-pi-sqlite skill; inspect schema before querying, keep result limits small, and prefer a backup plus an explicit transaction before authorized writes. Do not bypass safety gates to make destructive operations easier.`;

export function tool_guidance(
	options: BuildSystemPromptOptions,
	tools: readonly Tool[],
): string {
	const selected = options.selectedTools ?? [
		'read',
		'bash',
		'edit',
		'write',
	];
	const indirect =
		selected.includes('codemode') || selected.includes('tool_search');
	const reachable = tools.filter(
		(tool) =>
			tool.exposure !== 'hidden' &&
			(selected.includes(tool.name) ||
				(indirect &&
					['codemode', 'deferred'].includes(tool.exposure))),
	);
	const names = reachable
		.flatMap((tool) => [
			tool.name,
			tool.namespace?.name ?? '',
			...(tool.namespace?.aliases ?? []),
		])
		.join('\n');
	// Pi lists configured indirect servers before their background connections complete.
	const servers = indirect
		? (options.sections?.mcp_servers ?? '')
		: '';
	const available = `${names}\n${servers}`.toLowerCase();
	const shell =
		selected.some((name) => ['bash', 'powershell'].includes(name)) ||
		reachable.some((tool) =>
			['bash', 'powershell'].includes(tool.name),
		);
	return [
		shell ? NOPEEK_GUIDANCE : '',
		available.includes('omnisearch') ? OMNISEARCH_GUIDANCE : '',
		available.includes('sqlite') ? SQLITE_GUIDANCE : '',
	]
		.filter(Boolean)
		.join('\n\n');
}

export default function tool_guidance_extension(
	pi: ExtensionAPI,
): void {
	pi.on('before_agent_start', (event) => {
		const guidance = tool_guidance(
			event.systemPromptOptions,
			pi.getAllTools(),
		);
		if (guidance)
			event.systemPromptOptions.sections.my_pi_tool_guidance =
				guidance;
		else
			delete event.systemPromptOptions.sections.my_pi_tool_guidance;
	});
}
