import {
	is_app_navigation,
	parse_route,
	type Route,
} from './router.js';

class Router {
	url = $state(new URL(window.location.href));
	route: Route = $derived(parse_route(this.url));

	navigate(target: string, { replace = false } = {}): void {
		const next = new URL(target, window.location.href);
		if (replace) history.replaceState(null, '', next);
		else history.pushState(null, '', next);
		const same_view =
			next.searchParams.get('view') ===
				this.url.searchParams.get('view') &&
			next.searchParams.get('session') ===
				this.url.searchParams.get('session');
		this.url = next;
		if (!same_view) window.scrollTo({ top: 0 });
	}

	sync = (): void => {
		this.url = new URL(window.location.href);
	};

	handle_click = (event: MouseEvent): void => {
		const target = event.target;
		if (!(target instanceof Element)) return;
		const anchor = target.closest('a');
		if (!anchor || !is_app_navigation(event, anchor, location.origin))
			return;
		event.preventDefault();
		this.navigate(anchor.href);
	};
}

export const router = new Router();
