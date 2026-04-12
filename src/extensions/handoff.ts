// Handoff extension — extract session context for a new session
// Inspired by jayshah5696/pi-agent-extensions

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Default export for Pi Package / additionalExtensionPaths loading
export default async function handoff(pi: ExtensionAPI) {
	const history: Array<{
		role: string;
		summary: string;
		timestamp: number;
	}> = [];

	// Track conversation turns
	pi.on('message_end', async (event) => {
		const msg = event.message as unknown as Record<string, unknown>;
		if (!msg) return;

		const content = msg.content as
			| Array<{ type: string; text?: string }>
			| undefined;
		if (!Array.isArray(content)) return;

		const text = content
			.filter((c) => c.type === 'text')
			.map((c) => c.text || '')
			.join('\n');

		if (!text) return;

		const summary =
			text.length > 200 ? text.slice(0, 200) + '...' : text;

		history.push({
			role: (msg.role as string) || 'unknown',
			summary,
			timestamp: Date.now(),
		});
	});

	pi.registerCommand('handoff', {
		description:
			'Export session context as a handoff prompt for a new session',
		handler: async (args, ctx) => {
			const task = args.trim();

			if (history.length === 0) {
				ctx.ui.notify(
					'No conversation history to hand off',
					'warning',
				);
				return;
			}

			const context = history
				.map((h) => `[${h.role}] ${h.summary}`)
				.join('\n\n');

			const handoff = `## Handoff from Previous Session

### Context
The previous session covered the following:

${context}

### Task
${task || 'Continue from where the previous session left off.'}

### Instructions
- Review the context above to understand what was done
- Do NOT repeat work that was already completed
- Focus on the task described above
`;

			// Write to file
			const filename = `handoff-${Date.now()}.md`;
			const filepath = join(ctx.cwd, filename);
			writeFileSync(filepath, handoff, 'utf-8');

			ctx.ui.notify(
				`Handoff written to ${filename}\n\nUse: my-pi < ${filename}`,
			);
		},
	});
}
