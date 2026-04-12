// Recall extension — nudge the agent to use pirecall for past session context
// The model uses `npx pirecall` via bash directly — no custom tools needed

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_DB_PATH = join(process.env.HOME!, '.pi', 'pirecall.db');

// Default export for Pi Package / additionalExtensionPaths loading
export default async function recall(pi: ExtensionAPI) {
	// Sync on startup if db exists
	if (existsSync(DEFAULT_DB_PATH)) {
		try {
			execFileSync('npx', ['pirecall', 'sync', '--json'], {
				encoding: 'utf-8',
				timeout: 30_000,
				stdio: ['pipe', 'pipe', 'pipe'],
			});
		} catch {
			// Non-critical — db may just not have new data
		}
	}

	// System prompt hint so the model knows pirecall exists
	pi.on(
		'before_agent_start',
		async (event: { systemPrompt: string }) => {
			return {
				systemPrompt:
					event.systemPrompt +
					`

## Session Recall

You have access to past Pi session history via \`npx pirecall\`. Use it when:
- The user references prior work ("what did we do", "last time", "remember when")
- You need context from a previous session about this project
- You want to avoid repeating work already done

Quick reference:
- \`npx pirecall recall "<query>" --json\` — LLM-optimised context retrieval with surrounding messages
- \`npx pirecall search "<query>" --json\` — full-text search (supports FTS5: AND, OR, NOT, "phrase", prefix*)
- \`npx pirecall search "<query>" --json --project my-pi\` — filter by project
- \`npx pirecall search "<query>" --json --after 2026-04-10\` — filter by date
- \`npx pirecall sessions --json\` — list recent sessions
- \`npx pirecall stats --json\` — database statistics

Always pass \`--json\` for structured output.`,
			};
		},
	);
}
