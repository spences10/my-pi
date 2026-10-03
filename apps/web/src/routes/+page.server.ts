import { render_turn } from '#lib/server/highlight.js';
import { demo_conversation } from './session-data.js';

export const load = () => ({
	session: demo_conversation.map(render_turn),
});
