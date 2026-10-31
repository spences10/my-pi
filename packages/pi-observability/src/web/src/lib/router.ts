export type SessionTab = 'turns' | 'tools' | 'events' | 'context';

export type Route =
	| { name: 'overview' }
	| { name: 'sessions' }
	| { name: 'tools' }
	| { name: 'session'; id: string; tab: SessionTab };

const SESSION_TABS: SessionTab[] = [
	'turns',
	'tools',
	'events',
	'context',
];

// Views live in the query string: /sessions and /events are API paths,
// and the fragment carries the dashboard token.
export function parse_route(url: URL): Route {
	const view = url.searchParams.get('view');
	if (view === 'sessions') return { name: 'sessions' };
	if (view === 'tools') return { name: 'tools' };
	const id = url.searchParams.get('session');
	if (view === 'session' && id) {
		const tab = url.searchParams.get('tab') as SessionTab | null;
		return {
			name: 'session',
			id,
			tab: tab && SESSION_TABS.includes(tab) ? tab : 'turns',
		};
	}
	return { name: 'overview' };
}

export function href(route: Route): string {
	if (route.name === 'overview') return '/';
	if (route.name !== 'session') return `/?view=${route.name}`;
	const params = new URLSearchParams({
		view: 'session',
		session: route.id,
	});
	if (route.tab !== 'turns') params.set('tab', route.tab);
	return `/?${params}`;
}

export const session_href = (id: string, tab: SessionTab = 'turns') =>
	href({ name: 'session', id, tab });

/** True for a plain left click on a same-origin link to the dashboard. */
export function is_app_navigation(
	event: MouseEvent,
	anchor: HTMLAnchorElement,
	origin: string,
): boolean {
	if (
		event.defaultPrevented ||
		event.button !== 0 ||
		event.metaKey ||
		event.ctrlKey ||
		event.shiftKey ||
		event.altKey ||
		anchor.target ||
		anchor.hasAttribute('download')
	)
		return false;
	const url = new URL(anchor.href);
	return url.origin === origin && url.pathname === '/';
}
