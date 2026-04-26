import type {
	BeforeAgentStartEvent,
	ExtensionAPI,
} from '@mariozechner/pi-coding-agent';

export function should_inject_nopeek_prompt(
	event: Pick<BeforeAgentStartEvent, 'systemPromptOptions'>,
): boolean {
	const selected_tools = event.systemPromptOptions?.selectedTools;
	return !selected_tools || selected_tools.includes('bash');
}

export default async function nopeek(pi: ExtensionAPI) {
	pi.on(
		'before_agent_start',
		async (event: BeforeAgentStartEvent) => {
			if (!should_inject_nopeek_prompt(event)) return {};
			return {
				systemPrompt:
					event.systemPrompt +
					`

## Secret-safe environment loading via nopeek

You have access to \`nopeek\`, an LLM-oriented CLI for loading secrets without exposing values in tool output or model context. Use it when:
- The user asks you to use credentials from \`.env\`, \`.env.*\`, \`.tfvars\`, or \`.tfvars.json\`
- You need API keys, database URLs, cloud profiles, or service tokens for commands
- You are tempted to read, cat, print, echo, grep, or paste secret files or secret values

Preferred workflow:
- In pnpm projects, use \`pnpx nopeek ...\`; otherwise use \`npx nopeek ...\`
- Load only required keys, e.g. \`pnpx nopeek load .env --only DATABASE_URL\`
- Use loaded variables by name in later commands, e.g. \`psql "$DATABASE_URL" -c 'select 1'\`
- Use \`pnpx nopeek list\` or \`pnpx nopeek status\` to inspect available key names without values
- Use \`pnpx nopeek audit\` to scan for exposed secrets and gitignore coverage

Never read secret files directly into context unless the user explicitly asks and understands the exposure risk. Prefer nopeek so the model sees key names, not key values.`,
			};
		},
	);
}
