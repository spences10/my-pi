import { language as bash } from '@twinkleplop/bash';
import { language as json } from '@twinkleplop/json';
import { language as markdown } from '@twinkleplop/markdown';

const renderers = {
	bash: bash(),
	json: json(),
	markdown: markdown(),
};

export type CodeLanguage = keyof typeof renderers | 'text';

// Past this size highlighting slows the drawer down more than it helps.
const MAX_HIGHLIGHT_CHARS = 200_000;

export function escape_html(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

function plain(code: string): string {
	return `<pre class="twinkleplop language-text"><code>${escape_html(code)}</code></pre>`;
}

// twinkleplop's JSON grammar tags keys as plain strings. A string token
// directly followed by `:` is a key, so retag it as a property, the way
// editor themes colour JSON keys.
const JSON_KEY =
	/<span class="tok string">([^<]*)<\/span>(<span class="tok punctuation">:<\/span>)/g;

function mark_json_keys(html: string): string {
	return html.replace(
		JSON_KEY,
		'<span class="tok property">$1</span>$2',
	);
}

/**
 * Highlights code with twinkleplop. Unknown languages, very large
 * input, and grammar errors fall back to escaped plain text in the
 * same markup, so styles stay consistent.
 */
export function highlight(
	code: string,
	language: CodeLanguage,
): string {
	if (language === 'text' || code.length > MAX_HIGHLIGHT_CHARS)
		return plain(code);
	try {
		const html = renderers[language](code);
		return language === 'json' ? mark_json_keys(html) : html;
	} catch {
		return plain(code);
	}
}
