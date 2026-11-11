import { describe, expect, it } from 'vite-plus/test';
import { create_event_envelope, summarize_payload } from './index.js';
import { assistant_text } from './message-text.js';

const message = {
	role: 'assistant',
	content: [
		{ type: 'thinking', thinking: 'private reasoning' },
		{ type: 'text', text: 'First paragraph' },
		{
			type: 'toolCall',
			name: 'bash',
			arguments: { command: 'private command' },
		},
		{ type: 'image', data: 'private image' },
		{ type: 'text', text: 'Second paragraph' },
	],
};

describe('assistant response text', () => {
	it('joins only visible text blocks in order', () => {
		expect(assistant_text(message)).toEqual({
			text: 'First paragraph\nSecond paragraph',
			truncated: false,
		});
	});

	it.each(['user', 'toolResult', 'system'])(
		'does not capture %s content',
		(role) => {
			expect(assistant_text({ ...message, role })).toBeNull();
		},
	);

	it('distinguishes a tool-only response and bounds long text', () => {
		expect(
			assistant_text({
				role: 'assistant',
				content: [{ type: 'toolCall' }],
			}),
		).toEqual({ text: '', truncated: false });
		expect(
			assistant_text({
				role: 'assistant',
				content: 'x'.repeat(16_001),
			}),
		).toEqual({ text: 'x'.repeat(16_000), truncated: true });
	});

	it('captures text only once at message_end in detailed mode', () => {
		expect(
			summarize_payload({ message }, 'detailed', 'message_end'),
		).toMatchObject({
			responseText: 'First paragraph\nSecond paragraph',
			responseTextTruncated: false,
		});

		for (const type of [
			'message_start',
			'turn_end',
			'agent_end',
		] as const)
			expect(
				summarize_payload({ message }, 'detailed', type),
			).not.toHaveProperty('responseText');
		expect(
			summarize_payload({ message }, 'summary', 'message_end'),
		).not.toHaveProperty('responseText');
	});

	it('redacts captured responses and preserves truncation metadata', () => {
		const event = create_event_envelope(
			'message_end',
			{
				message: {
					role: 'assistant',
					content: [
						{
							type: 'text',
							text: `sk-${'a'.repeat(30)} ${'x'.repeat(16_000)}`,
						},
					],
				},
			},
			{ session_id: 's1', cwd: '/repo', pool: 'default', tags: [] },
			1,
			{
				raw_payloads: false,
				detail_level: 'detailed',
				max_payload_bytes: 0,
			},
		);

		expect(event.payload).toMatchObject({
			responseTextTruncated: true,
		});
		expect(
			(event.payload as { responseText: string }).responseText,
		).toMatch(/^\[REDACTED\] /);
		expect(JSON.stringify(event.payload)).not.toContain(
			'private reasoning',
		);
	});
});
