import { execFileSync } from 'node:child_process';
import {
	beforeEach,
	describe,
	expect,
	it,
	vi,
	type Mock,
} from 'vitest';
import { describe_port_owner } from './port-owner.js';

vi.mock('node:child_process', () => ({
	execFileSync: vi.fn(),
}));

const mocked_exec = vi.mocked(execFileSync) as unknown as Mock<
	(...args: Parameters<typeof execFileSync>) => string
>;

describe('describe_port_owner', () => {
	beforeEach(() => {
		mocked_exec.mockReset();
	});

	it('prefers lsof output when available', () => {
		mocked_exec.mockReturnValue('node 123 listen\n');

		expect(describe_port_owner(43190)).toBe('node 123 listen');
		expect(mocked_exec).toHaveBeenCalledWith(
			'lsof',
			['-nP', '-iTCP:43190', '-sTCP:LISTEN'],
			expect.any(Object),
		);
	});

	it('falls back to matching ss lines', () => {
		mocked_exec
			.mockImplementationOnce(() => {
				throw new Error('missing lsof');
			})
			.mockReturnValue(
				'LISTEN 0 1 127.0.0.1:43190 users:node\nLISTEN 0 1 127.0.0.1:9 other\n',
			);

		expect(describe_port_owner(43190)).toBe(
			'LISTEN 0 1 127.0.0.1:43190 users:node',
		);
	});

	it('returns an empty string when no process tools are available', () => {
		mocked_exec.mockImplementation(() => {
			throw new Error('unavailable');
		});

		expect(describe_port_owner(43190)).toBe('');
	});
});
