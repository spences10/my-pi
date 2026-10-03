import {
	render_turn,
	tokenize_lines,
} from '#lib/server/highlight.js';
import { demo_conversation } from './session-data.js';

// The hero shows the code that the session log adds to this file.
const edit = demo_conversation.find((turn) => turn.role === 'diff');
const hero_code = (edit?.hunks ?? [])
	.flatMap((hunk) => hunk.after ?? [])
	.map((line) => line.trim())
	.filter(Boolean)
	.join('\n');

export const load = () => ({
	session: demo_conversation.map(render_turn),
	hero_code: {
		path: edit?.path ?? '',
		lines: tokenize_lines(hero_code),
	},
});
