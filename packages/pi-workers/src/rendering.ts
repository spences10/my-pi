import type {
	MessageRenderer,
	ToolRenderers,
} from '@earendil-works/pi-coding-agent';
import { Text, TruncatedText } from '@earendil-works/pi-tui';
import type { WorkerInfo } from './manager.js';

export const render_worker_report: MessageRenderer<WorkerInfo> = (
	message,
	options,
	theme,
) => {
	const content =
		typeof message.content === 'string'
			? message.content
			: message.content
					.filter((block) => block.type === 'text')
					.map((block) => block.text)
					.join('\n');
	if (options.expanded)
		return new Text(
			`${content}\n\n${JSON.stringify(message.details, null, 2)}`,
			options.outputPad,
			0,
		);

	const info = message.details;
	const outcome = info?.error ? 'failed' : 'finished';
	const preview = (info?.error ?? info?.result ?? '(no text result)')
		.trim()
		.split('\n')[0];
	return new TruncatedText(
		theme.fg(
			info?.error ? 'error' : 'muted',
			`Worker · ${(info?.name ?? 'worker').replace(/\s+/g, ' ')} · ${outcome}: ${preview}`,
		) + ` (${options.keyHint('app.tools.expand', 'to expand')})`,
		options.outputPad,
		0,
	);
};

export const worker_tool_renderers: Required<
	Pick<ToolRenderers, 'renderCall' | 'renderResult'>
> = {
	renderCall(args, theme, context) {
		const title = theme.fg('toolTitle', theme.bold('Workers'));
		if (context.expanded)
			return new Text(
				`${title}\n${JSON.stringify(args, null, 2)}`,
				0,
				0,
			);
		const params = args as {
			action?: string;
			name?: string;
			worker?: string;
		};
		const target = params.name ?? params.worker;
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
		const info = result.details as
			| WorkerInfo
			| WorkerInfo[]
			| undefined;
		let preview = text.trim().split('\n')[0];
		if (!context.isError && info) {
			if (Array.isArray(info))
				preview = `${info.length} owned workers`;
			else
				preview = `${info.name} · ${info.status}${info.error ? `: ${info.error}` : ''}`;
		}
		return new TruncatedText(
			theme.fg(
				context.isError ? 'error' : 'muted',
				preview ||
					(options.isPartial ? 'Working…' : '(no text result)'),
			) + ` (${context.keyHint('app.tools.expand', 'to expand')})`,
			0,
			0,
		);
	},
};
