import type { Turn } from '#lib/components/session-log/types.js';

export const demo_conversation: Turn[] = [
	{
		role: 'user',
		text: 'add a token-bucket rate limiter to the public API guard, then run the unit tests',
	},
	{
		role: 'working',
		text: 'recalling previous session…',
	},
	{
		role: 'assistant',
		text: 'Recall has notes from yesterday: the limiter belongs in the route guard, keyed by client IP. Adding a token bucket and wiring it in.',
	},
	{
		role: 'read',
		path: 'src/lib/server/guard.ts',
		range: '1-9',
		code: `import type { RequestEvent } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';

export function guard(event: RequestEvent) {
  // auth + validation runs here
  return event;
}`,
		highlight: '{5}',
		lines_below: 23,
	},
	{
		role: 'assistant',
		text: 'lsp_diagnostics(src/lib/server/guard.ts) → 0 errors · 0 warnings · 4 symbols',
	},
	{
		role: 'diff',
		path: 'src/lib/server/guard.ts',
		hunks: [
			{
				after: [
					'const buckets = new Map<string, number>();',
					'const LIMIT = 60;',
					'',
				],
			},
			{
				before: ['  // auth + validation runs here'],
				after: [
					'  const ip = event.getClientAddress();',
					'  const left = buckets.get(ip) ?? LIMIT;',
					"  if (left <= 0) throw error(429, 'rate limited');",
					'  buckets.set(ip, left - 1);',
				],
			},
		],
	},
	{
		role: 'bash',
		command: 'pnpm test:unit -- --run',
		output:
			' Test Files  3 passed (3)\n      Tests  18 passed (18)\n   Duration  1.42s',
		exit_code: 0,
	},
	{
		role: 'assistant',
		text: 'Done — limiter in place, LSP shows the file clean, all 18 tests green. Want me to open a PR or hand it to a peer for review?',
	},
];
