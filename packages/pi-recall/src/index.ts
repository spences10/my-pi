// Recall extension — remind the model to use pirecall for past session context.
// pirecall remains the source of truth; this package only syncs and injects guidance.

import type {
	BeforeAgentStartEvent,
	ExtensionAPI,
} from '@mariozechner/pi-coding-agent';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_DB_PATH = join(
	process.env.HOME ?? process.env.USERPROFILE ?? '',
	'.pi',
	'pirecall.db',
);

export function should_inject_recall_prompt(
	event: Pick<BeforeAgentStartEvent, 'systemPromptOptions'>,
): boolean {
	const selected_tools = event.systemPromptOptions?.selectedTools;
	return !selected_tools || selected_tools.includes('bash');
}

function sync_recall_db(options: { wait: true }): Promise<void>;
function sync_recall_db(options?: { wait?: false }): void;
function sync_recall_db(
	options: { wait?: boolean } = {},
): Promise<void> | void {
	if (!DEFAULT_DB_PATH || !existsSync(DEFAULT_DB_PATH)) {
		return options.wait ? Promise.resolve() : undefined;
	}

	try {
		const proc = spawn('npx', ['pirecall', 'sync', '--json'], {
			stdio: 'ignore',
		});

		if (!options.wait) {
			proc.unref();
			return;
		}

		return new Promise((resolve) => {
			proc.on('error', () => resolve());
			proc.on('close', () => resolve());
		});
	} catch {
		return options.wait ? Promise.resolve() : undefined;
	}
}

export default async function recall(pi: ExtensionAPI) {
	pi.on('session_start', async () => {
		sync_recall_db();
	});

	pi.on('session_shutdown', async () => {
		await sync_recall_db({ wait: true });
	});

	pi.on(
		'before_agent_start',
		async (event: BeforeAgentStartEvent) => {
			if (!should_inject_recall_prompt(event)) return {};
			return {
				systemPrompt:
					event.systemPrompt +
					`

## Session Recall

You have access to past Pi session history via \`pirecall\`, an LLM-oriented CLI for recalling prior work. Use it when:
- The user references prior work ("what did we do", "last time", "remember when")
- You need context from a previous session about this project
- You want to avoid repeating work already done

Preferred workflow:
- In pnpm projects, use \`pnpx pirecall ...\`; otherwise use \`npx pirecall ...\`
- Always pass \`--json\` for structured output
- Use \`pnpx pirecall sync --json\` before searching when freshness matters

Quick reference:
- \`pnpx pirecall recall "<query>" --json\` — LLM-optimised context retrieval with surrounding messages
- \`pnpx pirecall search "<query>" --json\` — full-text search (supports FTS5: AND, OR, NOT, "phrase", prefix*)
- \`pnpx pirecall search "<query>" --json --project my-pi\` — filter by project
- \`pnpx pirecall search "<query>" --json --after 2026-04-10\` — filter by date
- \`pnpx pirecall sessions --json\` — list recent sessions
- \`pnpx pirecall stats --json\` — database statistics`,
			};
		},
	);
}
