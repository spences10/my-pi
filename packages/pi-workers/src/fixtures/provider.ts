import {
	createFauxCore,
	fauxAssistantMessage,
	fauxToolCall,
} from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

export default function provider(pi: ExtensionAPI) {
	const core = createFauxCore({
		provider: 'worker-test',
		api: 'worker-test',
		models: [{ id: 'test', name: 'Deterministic worker test' }],
		tokensPerSecond: 1000000,
	});
	pi.registerProvider('worker-test', {
		api: core.api,
		apiKey: 'test',
		baseUrl: 'http://unused.invalid',
		models: core.models,
		streamSimple(model, context, options) {
			core.setResponses([
				async (context) => {
					const last = context.messages.at(-1);
					if (last?.role === 'toolResult')
						return fauxAssistantMessage(
							'tool result: ' + JSON.stringify(last.content),
						);
					const text = context.messages
						.filter((message) => message.role === 'user')
						.at(-1)?.content;
					const prompt =
						typeof text === 'string'
							? text
							: (text ?? [])
									.filter((block) => block.type === 'text')
									.map((block) => block.text)
									.join('\n');
					if (prompt.startsWith('send-peer:')) {
						return fauxAssistantMessage(
							fauxToolCall('team', {
								action: 'session_send',
								to: prompt.slice('send-peer:'.length),
								message:
									'hello from ' + process.env.MY_PI_TEAM_MEMBER,
							}),
							{ stopReason: 'toolUse' },
						);
					}
					if (prompt === 'approval')
						return fauxAssistantMessage(fauxToolCall('probe', {}), {
							stopReason: 'toolUse',
						});
					return fauxAssistantMessage('reply: ' + prompt);
				},
			]);
			return core.streamSimple(model, context, options);
		},
	});
	pi.registerTool({
		name: 'probe',
		label: 'Probe',
		description: 'Test approval forwarding',
		parameters: Type.Object({}),
		async execute(_id, _args, _signal, _update, ctx) {
			const approved = await ctx.ui.confirm(
				'Allow probe?',
				'Test only',
			);
			return {
				content: [
					{ type: 'text', text: approved ? 'approved' : 'denied' },
				],
				details: {},
			};
		},
	});
}
