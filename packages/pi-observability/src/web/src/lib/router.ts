export type SessionTab =
	| 'trace'
	| 'turns'
	| 'tools'
	| 'events'
	| 'context';

export type Route =
	| { name: 'overview' }
	| { name: 'sessions' }
	| { name: 'tools' }
	| {
			name: 'session';
			id: string;
			tab: SessionTab;
			/** Trace span to select, e.g. tool:<call id>. */
			span: string | null;
	  };

const SESSION_TABS: SessionTab[] = [
	'trace',
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
			tab: tab && SESSION_TABS.includes(tab) ? tab : 'trace',
			span: url.searchParams.get('span'),
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
	if (route.tab !== 'trace') params.set('tab', route.tab);
	if (route.span) params.set('span', route.span);
	return `/?${params}`;
}

export const session_href = (
	id: string,
	tab: SessionTab = 'trace',
	span: string | null = null,
) => href({ name: 'session', id, tab, span });

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
