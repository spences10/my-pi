import {
	SettingsManager,
	type ExtensionContext,
	type SessionStartEvent,
} from '@earendil-works/pi-coding-agent';

const changelog_key = JSON.stringify({
	source: 'my-pi',
	scope: 'user',
});

const changelog_url =
	'https://github.com/spences10/my-pi/blob/main/packages/my-pi/CHANGELOG.md';

export function notify_release_update(
	version: string,
	event: SessionStartEvent,
	ctx: ExtensionContext,
): void {
	if (event.reason !== 'startup' || ctx.mode !== 'tui') return;

	if (
		ctx.sessionManager
			.getEntries()
			.some((entry) => entry.type === 'message')
	)
		return;

	const settings = SettingsManager.create(ctx.cwd);

	const last_version =
		settings.getExtensionChangelogVersion(changelog_key);

	if (!last_version) {
		settings.setExtensionChangelogVersion(changelog_key, version);

		return;
	}

	if (
		version.localeCompare(last_version, 'en', { numeric: true }) <= 0
	)
		return;

	ctx.ui.notify(
		`Updated my-pi to v${version}. Release notes: ${changelog_url}`,
		'info',
	);
	settings.setExtensionChangelogVersion(changelog_key, version);
}
