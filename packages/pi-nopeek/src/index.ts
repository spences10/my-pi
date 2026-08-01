import type {
	BeforeAgentStartEvent,
	ExtensionAPI,
} from '@earendil-works/pi-coding-agent';

export function should_inject_nopeek_prompt(
	event: Pick<BeforeAgentStartEvent, 'systemPromptOptions'>,
): boolean {
	const selected_tools = event.systemPromptOptions?.selectedTools;
	return !selected_tools || selected_tools.includes('bash');
}

export const NOPEEK_THREAT_MODEL_URL =
	'https://github.com/spences10/nopeek#threat-model-and-non-goals';

export const NOPEEK_SYSTEM_PROMPT = `

## Secret-reducing environment loading via nopeek

You have access to \`nopeek\`, an LLM-oriented CLI that reduces accidental secret disclosure during credential-dependent commands. Use it when:
- The user asks you to use credentials from \`.env\`, \`.env.*\`, \`.tfvars\`, or \`.tfvars.json\`
- You need API keys, database URLs, cloud profiles, or service tokens for commands
- You are tempted to read, cat, print, echo, grep, or paste secret files or secret values

Preferred workflow:
- In pnpm projects, use \`pnpx nopeek ...\`; otherwise use \`npx nopeek ...\`
- In Pi's ephemeral tool shells, lead with one-shot execution: \`pnpx nopeek run .env --only DATABASE_URL -- sh -c 'psql "$DATABASE_URL" -c "select 1"'\`
- Select only the required keys. \`run\` gives them to one child process, but that child can still disclose them through stdout, stderr, tracing, or commands such as \`env\` and \`printenv\`
- Use \`nopeek load\` only when the harness confirms persistent env-file injection, or when loading and execution occur in the same trusted shell through source/evaluation. A \`source_file\` result does not carry into an unrelated Pi tool call
- Use \`pnpx nopeek list\` or \`pnpx nopeek status\` to inspect available key names without values
- Use \`pnpx nopeek audit\` to scan for exposed secrets and gitignore coverage
- Treat \`pi-redact\` as a separate, best-effort last-mile safety net; it cannot guarantee that arbitrary child output is safe
- Review nopeek's threat model and non-goals: ${NOPEEK_THREAT_MODEL_URL}

Never read secret files directly into context unless the user explicitly asks and understands the exposure risk. Prefer workflows that keep values out of model-visible input and output.`;

export default async function nopeek(pi: ExtensionAPI) {
	pi.on(
		'before_agent_start',
		async (event: BeforeAgentStartEvent) => {
			if (!should_inject_nopeek_prompt(event)) return {};
			return {
				systemPrompt: event.systemPrompt + NOPEEK_SYSTEM_PROMPT,
			};
		},
	);
}
