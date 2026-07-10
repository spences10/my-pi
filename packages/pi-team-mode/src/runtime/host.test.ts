import { describe, expect, it, vi } from 'vitest';
import {
	accept_agent_prompt,
	persistent_coordination_prompt,
} from './host.js';

describe('persistent runtime host prompt acceptance', () => {
	it('routes final and nested reports to the lead deterministically', () => {
		const prompt = persistent_coordination_prompt({
			from_session_id: 'lead',
			report_to_session_ids: ['lead', 'orchestrator'],
		});

		expect(prompt).toContain('lead, orchestrator');
		expect(prompt).toContain('team session_send');
		expect(prompt).toContain('reply_to or to=lead,orchestrator');
		expect(prompt).toContain('continue the parent task');
	});

	it('resolves at AgentSession preflight without waiting for the run to settle', async () => {
		let settle!: () => void;
		const completion = new Promise<void>((resolve) => {
			settle = resolve;
		});
		const prompt = vi.fn(
			async (
				_message: string,
				options: { preflightResult: (success: boolean) => void },
			) => {
				options.preflightResult(true);
				await completion;
			},
		);

		await expect(
			accept_agent_prompt({ prompt }, 'initial task'),
		).resolves.toBeUndefined();
		expect(prompt).toHaveBeenCalledWith(
			'initial task',
			expect.objectContaining({
				source: 'extension',
				preflightResult: expect.any(Function),
			}),
		);
		settle();
	});

	it('reports preflight rejection', async () => {
		const prompt = vi.fn(
			async (
				_message: string,
				options: { preflightResult: (success: boolean) => void },
			) => options.preflightResult(false),
		);

		await expect(
			accept_agent_prompt({ prompt }, 'rejected task'),
		).rejects.toThrow('rejected during preflight');
	});
});
