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

// Static page: the npm version is read one time, at build.
export const prerender = true;

async function published_version() {
	try {
		const response = await fetch(
			'https://registry.npmjs.org/my-pi/latest',
			{
				signal: AbortSignal.timeout(5000),
			},
		);
		if (!response.ok) return null;
		const { version } = (await response.json()) as {
			version?: string;
		};
		return version ?? null;
	} catch {
		return null;
	}
}

export const load = async () => ({
	version: await published_version(),
	session: demo_conversation.map(render_turn),
	hero_code: {
		path: edit?.path ?? '',
		lines: tokenize_lines(hero_code),
	},
});
