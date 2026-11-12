import type {
	MessageRenderer,
	ToolRenderers,
} from '@earendil-works/pi-coding-agent';
import { Text, TruncatedText } from '@earendil-works/pi-tui';
import type { TeamModePeerMessageDetails } from './coordination-formatting.js';
import type { TeamToolParams } from './team-tool-params.js';

export const render_peer_message: MessageRenderer<
	TeamModePeerMessageDetails
> = (message, options, theme) => {
	const content = Array.isArray(message.content)
		? message.content
				.filter((block) => block.type === 'text')
				.map((block) => block.text)
				.join('\n')
		: message.content;

	if (options.expanded)
		return new Text(content, options.outputPad, 0);

	const messages = message.details?.messages ?? [];
	const first = messages[0];

	const sender =
		first?.from_agent_name ??
		first?.from_session_id.slice(0, 12) ??
		'peer';

	const body =
		content
			.split('\n')
			.find((line) => line.startsWith('> '))
			?.slice(2) ?? 'Peer message';

	const more =
		messages.length > 1 ? ` (+${messages.length - 1} more)` : '';

	return new TruncatedText(
		theme.fg(
			'muted',
			`Team · ${sender.replace(/\s+/g, ' ')} · ${first?.message_type ?? 'action'}: ${body}${more}`,
		) + ` (${options.keyHint('app.tools.expand', 'to expand')})`,
		options.outputPad,
		0,
	);
};

export const team_tool_renderers: Required<
	Pick<ToolRenderers, 'renderCall' | 'renderResult'>
> = {
	renderCall(args, theme, context) {
		const title = theme.fg('toolTitle', theme.bold('Team'));

		if (context.expanded)
			return new Text(
				`${title}\n${JSON.stringify(args, null, 2)}`,
				0,
				0,
			);
		const params = args as Partial<TeamToolParams>;

		const target =
			params.to ??
			params.from ??
			params.team_id ??
			params.artifact_id ??
			params.name;

		return new TruncatedText(
			`${title} · ${params.action ?? ''}${target ? ` · ${target}` : ''}`.replace(
				/\s+/g,
				' ',
			),
			0,
			0,
		);
	},
	renderResult(result, options, theme, context) {
		const text = result.content
			.filter((block) => block.type === 'text')
			.map((block) => block.text)
			.join('\n');

		if (options.expanded) return new Text(text, 0, 0);

		const preview =
			text.trim().split('\n')[0] ||
			(options.isPartial ? 'Working…' : '(no text result)');

		return new TruncatedText(
			theme.fg(context.isError ? 'error' : 'muted', preview) +
				` (${context.keyHint('app.tools.expand', 'to expand')})`,
			0,
			0,
		);
	},
};
