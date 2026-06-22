import { readFileSync } from 'node:fs';

const DASHBOARD_HTML_URL = new URL(
	'./web/index.html',
	import.meta.url,
);
const FONT_URLS = new Map([
	[
		'/fonts/victor-mono-latin-400-normal.woff2',
		new URL(
			'./fonts/victor-mono-latin-400-normal.woff2',
			import.meta.url,
		),
	],
	[
		'/fonts/victor-mono-latin-700-normal.woff2',
		new URL(
			'./fonts/victor-mono-latin-700-normal.woff2',
			import.meta.url,
		),
	],
]);
const SERVER_STARTED_AT = new Date().toISOString();

function read_dashboard_html(): string {
	return readFileSync(DASHBOARD_HTML_URL, 'utf8');
}

export function read_dashboard_asset(
	pathname: string,
): Buffer | undefined {
	if (!pathname.startsWith('/assets/')) return undefined;
	try {
		return readFileSync(new URL(`./web${pathname}`, import.meta.url));
	} catch {
		return undefined;
	}
}

export function content_type(pathname: string): string {
	if (pathname.endsWith('.css')) return 'text/css; charset=utf-8';
	if (pathname.endsWith('.js'))
		return 'text/javascript; charset=utf-8';
	if (pathname.endsWith('.svg')) return 'image/svg+xml';
	return 'application/octet-stream';
}

export function read_dashboard_font(
	pathname: string,
): Buffer | undefined {
	const url = FONT_URLS.get(pathname);
	return url ? readFileSync(url) : undefined;
}

function escape_html(value: string): string {
	return value.replace(/[&<>]/g, (char) => {
		if (char === '&') return '&amp;';
		if (char === '<') return '&lt;';
		return '&gt;';
	});
}

export function render_dashboard(db_path: string): string {
	return read_dashboard_html()
		.replaceAll('__DB_PATH__', escape_html(db_path))
		.replaceAll('__BUILD__', escape_html(SERVER_STARTED_AT));
}
