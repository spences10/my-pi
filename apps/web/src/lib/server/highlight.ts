import type {
	RenderedTurn,
	Turn,
} from '#lib/components/session-log/types.js';
import { language as bash } from '@twinkleplop/bash';
import { create_renderer } from '@twinkleplop/markdown-core';
import { language as typescript } from '@twinkleplop/typescript';

const renderer = create_renderer({
	languages: { bash: bash(), ts: typescript() },
	on_unknown_language: 'plain',
});

const fence = (language: string, code: string, meta?: string) =>
	renderer.fence(language, meta, code) ?? '';

const line_range = (start: number, count: number) =>
	count > 1 ? `${start}-${start + count - 1}` : `${start}`;

// Highlight on the server, so the browser gets HTML and no highlighter.
export function render_turn(turn: Turn): RenderedTurn {
	if (turn.role === 'read') {
		const { code: _code, highlight, ...rest } = turn;
		return { ...rest, html: fence('ts', turn.code, highlight) };
	}
	if (turn.role === 'bash') {
		return { ...turn, command_html: fence('bash', turn.command) };
	}
	if (turn.role === 'diff') {
		const lines: string[] = [];
		const removed: string[] = [];
		const added: string[] = [];
		for (const hunk of turn.hunks) {
			for (const [source, target] of [
				[hunk.before ?? [], removed],
				[hunk.after ?? [], added],
			] as const) {
				if (!source.length) continue;
				target.push(line_range(lines.length + 1, source.length));
				lines.push(...source);
			}
		}
		const meta = [
			removed.length && `{${removed.join(',')}}#removed`,
			added.length && `{${added.join(',')}}#added`,
		]
			.filter(Boolean)
			.join(' ');
		return {
			role: 'diff',
			path: turn.path,
			html: fence('ts', lines.join('\n'), meta),
		};
	}
	return turn;
}
