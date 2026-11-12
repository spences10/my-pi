const ESC = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g');

export function strip_ansi(text: string): string {
	return text.replace(ANSI_PATTERN, '');
}

export function sanitize_status_text(text: string): string {
	return strip_ansi(text)
		.replace(/[\r\n\t]/g, ' ')
		.replace(/ +/g, ' ')
		.trim();
}

export function format_token_count(count: number): string {
	if (count < 1000) return count.toString();

	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;

	if (count < 1000000) return `${Math.round(count / 1000)}k`;

	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;

	return `${Math.round(count / 1000000)}M`;
}
