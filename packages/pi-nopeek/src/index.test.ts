import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';
import nopeek, * as nopeek_entrypoint from './index.js';

type PromptEvent = {
	systemPrompt: string;
	systemPromptOptions?: { selectedTools?: string[] };
};
type PromptHandler = (
	event: PromptEvent,
) => Promise<Record<string, unknown>>;

async function register_prompt_handler(): Promise<PromptHandler> {
	const on = vi.fn();
	await nopeek({ on } as unknown as ExtensionAPI);
	expect(on).toHaveBeenCalledWith(
		'before_agent_start',
		expect.any(Function),
	);
	return on.mock.calls[0]?.[1] as PromptHandler;
}

describe('nopeek extension', () => {
	it('preserves the published prompt guard named export', () => {
		expect(nopeek_entrypoint.should_inject_nopeek_prompt).toBeTypeOf(
			'function',
		);
	});

	it('snapshots the ephemeral-shell run guidance', () => {
		expect(nopeek_entrypoint.NOPEEK_SYSTEM_PROMPT)
			.toMatchInlineSnapshot(`
			"

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
			- Review nopeek's threat model and non-goals: https://github.com/spences10/nopeek#threat-model-and-non-goals

			Never read secret files directly into context unless the user explicitly asks and understands the exposure risk. Prefer workflows that keep values out of model-visible input and output."
		`);
	});

	it('keeps run primary and states the remaining safety boundaries', () => {
		const prompt = nopeek_entrypoint.NOPEEK_SYSTEM_PROMPT;
		expect(prompt).toContain('lead with one-shot execution');
		expect(prompt).toContain('nopeek run .env --only DATABASE_URL');
		expect(prompt).toContain(
			'only when the harness confirms persistent env-file injection',
		);
		expect(prompt).toContain('source_file');
		expect(prompt).toContain('pi-redact');
		expect(prompt).toContain('best-effort last-mile safety net');
		expect(prompt).toContain(
			nopeek_entrypoint.NOPEEK_THREAT_MODEL_URL,
		);
		expect(prompt).not.toContain(
			'Use loaded variables by name in later commands',
		);
	});

	it('injects guidance when selected tools are unavailable', async () => {
		const handler = await register_prompt_handler();
		await expect(
			handler({ systemPrompt: 'base', systemPromptOptions: {} }),
		).resolves.toEqual({
			systemPrompt: expect.stringMatching(
				/^base\n\n## Secret-reducing environment loading via nopeek/,
			),
		});
	});

	it('injects guidance when bash is active', async () => {
		const handler = await register_prompt_handler();
		await expect(
			handler({
				systemPrompt: 'base',
				systemPromptOptions: { selectedTools: ['read', 'bash'] },
			}),
		).resolves.toEqual({
			systemPrompt: expect.stringContaining(
				'Secret-reducing environment loading via nopeek',
			),
		});
	});

	it('skips guidance when bash is unavailable', async () => {
		const handler = await register_prompt_handler();
		await expect(
			handler({
				systemPrompt: 'base',
				systemPromptOptions: { selectedTools: ['read', 'write'] },
			}),
		).resolves.toEqual({});
	});
});
