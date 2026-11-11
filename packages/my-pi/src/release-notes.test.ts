import {
	SettingsManager,
	type ExtensionContext,
	type SessionStartEvent,
} from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { notify_release_update } from './release-notes.js';

const key = JSON.stringify({ source: 'my-pi', scope: 'user' });
const startup = { type: 'session_start', reason: 'startup' } as const;

afterEach(() => vi.restoreAllMocks());

function setup(last_version?: string) {
	const settings = SettingsManager.inMemory();

	if (last_version)
		settings.setExtensionChangelogVersion(key, last_version);

	const create = vi
		.spyOn(SettingsManager, 'create')
		.mockReturnValue(settings);

	const notify = vi.fn();

	const ctx = {
		mode: 'tui',
		cwd: '/tmp',
		sessionManager: { getEntries: () => [] },
		ui: { notify },
	} as unknown as ExtensionContext;

	return { settings, create, notify, ctx };
}

describe('launcher release notices', () => {
	it('records a fresh install using upstream version storage without notifying', () => {
		const { settings, notify, ctx } = setup();
		notify_release_update('0.7.0', startup, ctx);
		expect(settings.getExtensionChangelogVersion(key)).toBe('0.7.0');
		expect(notify).not.toHaveBeenCalled();
	});

	it('notifies once after an upgrade and links the shipped release notes', () => {
		const { settings, notify, ctx } = setup('0.7.0');
		notify_release_update('0.8.0', startup, ctx);
		notify_release_update('0.8.0', startup, ctx);
		expect(notify).toHaveBeenCalledExactlyOnceWith(
			expect.stringContaining('Updated my-pi to v0.8.0.'),
			'info',
		);
		expect(notify.mock.calls[0]![0]).toContain(
			'/packages/my-pi/CHANGELOG.md',
		);
		expect(settings.getExtensionChangelogVersion(key)).toBe('0.8.0');
	});

	it.each(['0.7.0', '0.6.0'])(
		'does not notify for an unchanged version or downgrade (%s)',
		(version) => {
			const { notify, ctx } = setup('0.7.0');
			notify_release_update(version, startup, ctx);
			expect(notify).not.toHaveBeenCalled();
		},
	);

	it('compares version components numerically', () => {
		const { notify, ctx } = setup('0.9.0');
		notify_release_update('0.10.0', startup, ctx);
		expect(notify).toHaveBeenCalledOnce();
	});

	it.each(['reload', 'resume', 'fork', 'new'] as const)(
		'does not consume notices during %s',
		(reason) => {
			const { create, notify, ctx } = setup('0.7.0');
			notify_release_update(
				'0.8.0',
				{ ...startup, reason } satisfies SessionStartEvent,
				ctx,
			);
			expect(create).not.toHaveBeenCalled();
			expect(notify).not.toHaveBeenCalled();
		},
	);

	it.each(['print', 'json', 'rpc'] as const)(
		'leaves %s output untouched',
		(mode) => {
			const { create, notify, ctx } = setup('0.7.0');
			notify_release_update('0.8.0', startup, { ...ctx, mode });
			expect(create).not.toHaveBeenCalled();
			expect(notify).not.toHaveBeenCalled();
		},
	);

	it('leaves notices pending when continuing a session with messages', () => {
		const { create, notify, ctx } = setup('0.7.0');
		ctx.sessionManager.getEntries = () =>
			[{ type: 'message' }] as never;
		notify_release_update('0.8.0', startup, ctx);
		expect(create).not.toHaveBeenCalled();
		expect(notify).not.toHaveBeenCalled();
	});
});
