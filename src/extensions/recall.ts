// Recall extension — search past Pi sessions via pirecall SQLite database
// Gives the agent access to conversation history from previous sessions

import {
	type ExtensionFactory,
	defineTool,
} from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_DB_PATH = join(
	process.env.HOME!,
	'.pi',
	'pirecall.db',
);

function run_pirecall(
	args: string[],
): { ok: true; data: unknown } | { ok: false; error: string } {
	try {
		const output = execFileSync('npx', ['pirecall', ...args], {
			encoding: 'utf-8',
			timeout: 15_000,
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		return { ok: true, data: JSON.parse(output) };
	} catch (err) {
		const message =
			err instanceof Error ? err.message : String(err);
		return { ok: false, error: message };
	}
}

export function create_recall_extension(): ExtensionFactory {
	return async (pi) => {
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

		// ── Tool: recall (LLM-optimised context retrieval) ──

		pi.registerTool(
			defineTool({
				name: 'recall',
				label: 'Recall Past Sessions',
				description:
					'Search past Pi agent sessions for relevant context. Returns conversation snippets matching the query. Use this when the user references prior work, asks "what did we do", or when you need context from a previous session.',
				parameters: Type.Object({
					query: Type.String({
						description:
							'Search term — supports FTS5 syntax: AND, OR, NOT, "exact phrase", prefix*',
					}),
					limit: Type.Optional(
						Type.Number({
							description:
								'Maximum matches to return (default: 5)',
						}),
					),
					context: Type.Optional(
						Type.Number({
							description:
								'Messages before/after each match (default: 2)',
						}),
					),
					project: Type.Optional(
						Type.String({
							description:
								'Filter by project path (substring match)',
						}),
					),
				}),
				execute: async (_id, params) => {
					const args = [
						'recall',
						params.query,
						'--json',
					];
					if (params.limit)
						args.push('--limit', String(params.limit));
					if (params.context)
						args.push(
							'--context',
							String(params.context),
						);
					if (params.project)
						args.push('--project', params.project);

					const result = run_pirecall(args);

					if (!result.ok) {
						return {
							content: [
								{
									type: 'text' as const,
									text: `Recall failed: ${result.error}`,
								},
							],
							details: {},
						};
					}

					return {
						content: [
							{
								type: 'text' as const,
								text: JSON.stringify(
									result.data,
									null,
									2,
								),
							},
						],
						details: {},
					};
				},
			}),
		);

		// ── Tool: recall_search (full-text search with more options) ──

		pi.registerTool(
			defineTool({
				name: 'recall_search',
				label: 'Search Past Sessions',
				description:
					'Full-text search across all past session messages. More detailed than recall — returns individual message matches with metadata. Use for specific lookups.',
				parameters: Type.Object({
					query: Type.String({
						description:
							'Search term — supports FTS5: AND, OR, NOT, "phrase", prefix*',
					}),
					limit: Type.Optional(
						Type.Number({
							description:
								'Maximum results (default: 20)',
						}),
					),
					project: Type.Optional(
						Type.String({
							description: 'Filter by project path',
						}),
					),
					session: Type.Optional(
						Type.String({
							description:
								'Filter by session ID (prefix match)',
						}),
					),
					after: Type.Optional(
						Type.String({
							description:
								'Only results after date (ISO format, e.g. 2026-04-06)',
						}),
					),
					sort: Type.Optional(
						Type.String({
							description:
								'Sort: relevance (default), time, time-asc',
						}),
					),
				}),
				execute: async (_id, params) => {
					const args = [
						'search',
						params.query,
						'--json',
					];
					if (params.limit)
						args.push('--limit', String(params.limit));
					if (params.project)
						args.push('--project', params.project);
					if (params.session)
						args.push('--session', params.session);
					if (params.after)
						args.push('--after', params.after);
					if (params.sort)
						args.push('--sort', params.sort);

					const result = run_pirecall(args);

					if (!result.ok) {
						return {
							content: [
								{
									type: 'text' as const,
									text: `Search failed: ${result.error}`,
								},
							],
							details: {},
						};
					}

					return {
						content: [
							{
								type: 'text' as const,
								text: JSON.stringify(
									result.data,
									null,
									2,
								),
							},
						],
						details: {},
					};
				},
			}),
		);

		// ── Command: /recall (user-facing) ──

		pi.registerCommand('recall', {
			description:
				'Search past sessions — /recall <query> [--limit N] [--project path]',
			handler: async (args, ctx) => {
				const query = args.trim();
				if (!query) {
					ctx.ui.notify(
						'Usage: /recall <search query>',
						'warning',
					);
					return;
				}

				// Sync first
				ctx.ui.notify('Syncing sessions...');
				run_pirecall(['sync', '--json']);

				const result = run_pirecall([
					'recall',
					query,
					'--json',
					'--limit',
					'5',
					'--context',
					'2',
				]);

				if (!result.ok) {
					ctx.ui.notify(
						`Recall failed: ${result.error}`,
						'error',
					);
					return;
				}

				// Paste results into the editor for the user to send
				const data = result.data as {
					matches?: Array<{
						session_id: string;
						project: string;
						date: string;
						messages: Array<{
							role: string;
							text: string;
						}>;
					}>;
				};

				if (
					!data.matches ||
					data.matches.length === 0
				) {
					ctx.ui.notify(
						`No results for "${query}"`,
						'warning',
					);
					return;
				}

				const formatted = data.matches
					.map((m) => {
						const msgs = m.messages
							.map(
								(msg) =>
									`  [${msg.role}] ${msg.text?.slice(0, 300) || '(empty)'}`,
							)
							.join('\n');
						return `## ${m.project} (${m.date})\nSession: ${m.session_id.slice(0, 8)}\n${msgs}`;
					})
					.join('\n\n---\n\n');

				ctx.ui.pasteToEditor(
					`Here is relevant context from past sessions about "${query}":\n\n${formatted}`,
				);
			},
		});
	};
}
