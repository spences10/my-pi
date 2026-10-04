import { site_config } from '#lib/config/site.js';

export const prerender = true;

// One page. No <lastmod>: the page has no reliable change date.
export const GET = () =>
	new Response(
		`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${site_config.url}/</loc>
  </url>
</urlset>
`,
		{ headers: { 'Content-Type': 'application/xml' } },
	);
