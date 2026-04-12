// Filter-output extension — redact secrets from tool output
// Patterns from https://github.com/spences10/nopeek

import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';

interface SecretPattern {
	name: string;
	pattern: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
	{ name: 'AWS Access Key', pattern: /AKIA[A-Z0-9]{16}/g },
	{
		name: 'AWS Secret Key',
		pattern:
			/(?:SecretAccessKey|aws_secret_access_key)\s*[:=]\s*[A-Za-z0-9/+=]{40}/g,
	},
	{
		name: 'Bearer Token',
		pattern: /Bearer\s+[a-zA-Z0-9._-]{20,}/g,
	},
	{
		name: 'OpenAI/Anthropic API Key',
		pattern: /sk-[a-zA-Z0-9._-]{20,}/g,
	},
	{
		name: 'Stripe Live Key',
		pattern: /sk_live_[a-zA-Z0-9]{20,}/g,
	},
	{
		name: 'Stripe Test Key',
		pattern: /sk_test_[a-zA-Z0-9]{20,}/g,
	},
	{
		name: 'Hetzner Token',
		pattern:
			/(?:HCLOUD_TOKEN|hcloud_token|token)\s*[:=]\s*["']?[a-f0-9]{64}\b/g,
	},
	{
		name: 'Private Key',
		pattern: /-----BEGIN\s+[\w\s]*PRIVATE\s+KEY-----/g,
	},
	{
		name: 'Connection String with Password',
		pattern: /:\/\/[^:]+:[^@]+@/g,
	},
	{
		name: 'Generic Password Field',
		pattern:
			/(?:password|passwd|secret|token)\s*[:=]\s*["']?[^\s"']{8,}/gi,
	},
	{
		name: 'Tavily API Key',
		pattern: /tvly-[a-zA-Z0-9_-]{20,}/g,
	},
	{
		name: 'Kagi API Key',
		pattern: /[a-zA-Z0-9_-]{40,}\.[a-zA-Z0-9_-]{40,}/g,
	},
	{
		name: 'Brave API Key',
		pattern: /BSA[A-Z0-9]{20,}/g,
	},
	{
		name: 'Firecrawl API Key',
		pattern: /fc-[a-f0-9]{32}/g,
	},
	{
		name: 'GitHub Token',
		pattern: /gh[pousr]_[a-zA-Z0-9]{36,}/g,
	},
];

function redact(text: string): { redacted: string; count: number } {
	let count = 0;
	let result = text;

	for (const sp of SECRET_PATTERNS) {
		// Reset lastIndex for global regexes
		sp.pattern.lastIndex = 0;
		result = result.replace(sp.pattern, (match) => {
			count++;
			const prefix = match.slice(0, 4);
			return `${prefix}${'*'.repeat(Math.min(match.length - 4, 20))}[REDACTED:${sp.name}]`;
		});
	}

	return { redacted: result, count };
}

export function create_filter_output_extension(): ExtensionFactory {
	return async (pi) => {
		let totalRedacted = 0;

		// Intercept tool results to redact secrets before the LLM sees them
		pi.on('tool_result', async (event) => {
			if (!event.content) return {};

			let modified = false;
			const newContent = event.content.map(
				(item: { type: string; text?: string }) => {
					if (item.type !== 'text' || !item.text) return item;
					const { redacted, count } = redact(item.text);
					if (count > 0) {
						modified = true;
						totalRedacted += count;
					}
					return { ...item, text: redacted };
				},
			);

			if (modified) {
				return { content: newContent };
			}

			return {};
		});

		pi.registerCommand('redact-stats', {
			description: 'Show how many secrets have been redacted',
			handler: async (_args, ctx) => {
				ctx.ui.notify(
					`Secrets redacted this session: ${totalRedacted}`,
				);
			},
		});
	};
}
