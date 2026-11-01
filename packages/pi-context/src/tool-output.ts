import type { ToolResultEvent } from '@earendil-works/pi-coding-agent';
import { is_text_content } from './context-scope.js';

/** Prefer native machine-readable output over an already truncated chat preview. */
export function select_context_output(
	event: ToolResultEvent,
	visible_text: string,
): string {
	const value: unknown = event.structuredContent;
	const structured =
		value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: undefined;
	if (
		(event.toolName === 'bash' || event.toolName === 'powershell') &&
		structured &&
		typeof structured.output === 'string'
	) {
		if (structured.truncated === true) {
			const path =
				typeof structured.full_output_path === 'string'
					? ` Full output: ${structured.full_output_path}`
					: '';
			return `[Partial native output; omitted text is not indexed.${path}]\n${structured.output}`;
		}
		return structured.output;
	}

	if (
		event.toolName.startsWith('mcp__') &&
		structured &&
		Array.isArray(structured.content) &&
		structured.content.every(
			(item) =>
				is_text_content(item) ||
				(item &&
					typeof item === 'object' &&
					'type' in item &&
					item.type === 'image'),
		)
	) {
		const text = structured.content.filter(is_text_content);
		if (text.length > 0)
			return text.map((item) => item.text).join('\n');
	}

	const details = event.details;
	const truncation =
		details && typeof details === 'object' && 'truncation' in details
			? details.truncation
			: undefined;
	const truncated =
		truncation &&
		typeof truncation === 'object' &&
		'truncated' in truncation &&
		truncation.truncated === true;
	if (
		details &&
		typeof details === 'object' &&
		(truncated ||
			('fullOutputPath' in details && details.fullOutputPath))
	) {
		return `[Partial native output; omitted text is not indexed.]\n${visible_text}`;
	}
	return visible_text;
}
