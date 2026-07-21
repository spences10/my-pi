import { describe, expect, it, vi } from 'vitest';
import { register_session_name_sync } from './session-name-sync.js';

function setup(fallback_agent_name?: string) {
	let handler:
		| ((event: { name: string | undefined }) => void)
		| undefined;
	const update_session_agent_name = vi.fn();
	register_session_name_sync(
		{
			on: vi.fn((_event, registered_handler) => {
				handler = registered_handler;
			}),
		},
		{ update_session_agent_name },
		() => 'session-1',
		fallback_agent_name,
	);
	return {
		emit: (name: string | undefined) => handler?.({ name }),
		update_session_agent_name,
	};
}

describe('register_session_name_sync', () => {
	it('updates and clears the current coordination session name from Pi events', () => {
		const harness = setup();
		harness.emit('renamed');
		harness.emit(undefined);

		expect(harness.update_session_agent_name.mock.calls).toEqual([
			['session-1', 'renamed'],
			['session-1', undefined],
		]);
	});

	it('restores the configured identity when a Pi session name is cleared', () => {
		const harness = setup('configured-name');
		harness.emit(undefined);

		expect(harness.update_session_agent_name).toHaveBeenCalledWith(
			'session-1',
			'configured-name',
		);
	});
});
