import type { ContextStore } from '../store.js';
import type { SeededSource } from './types.js';

export const PROJECT = '/tmp/pi-context-eval-project';
export const SESSION = '/tmp/pi-context-eval-session.jsonl';

export function make_noise_lines(
	count: number,
	prefix: string,
): string {
	return Array.from(
		{ length: count },
		(_, index) => `${prefix} noise line ${index} ${'x'.repeat(48)}`,
	).join('\n');
}

export function source_texts() {
	return {
		'needle-log': {
			tool_name: 'bash',
			text: [
				make_noise_lines(80, 'before'),
				'TARGET_VALUE appears on line 855 with surrounding diagnostic text',
				make_noise_lines(80, 'after'),
			].join('\n'),
		},
		'staging-help': {
			tool_name: 'bash',
			text: [
				'Interactive git UI help',
				'Press space to stage this hunk.',
				'Press enter to open the selected file.',
				'Use a to amend after review.',
				make_noise_lines(40, 'staging'),
			].join('\n'),
		},
		'skill-script': {
			tool_name: 'read',
			text: [
				'case "$command" in',
				'  update) run_gh_skill_update "$repo" ;;',
				'  install) run_gh_skill_install "$repo" ;;',
				'esac',
				make_noise_lines(40, 'script'),
			].join('\n'),
		},
		'code-symbols': {
			tool_name: 'read',
			text: [
				"pi.registerCommand('context-stats', {",
				"  description: 'Show context sidecar byte accounting',",
				'});',
				make_noise_lines(40, 'code'),
			].join('\n'),
		},
		'chunk-boundary': {
			tool_name: 'mcp__mcp-omnisearch__web_extract',
			text: [
				`alpha-token ${'a'.repeat(5000)}`,
				'',
				`omega-token ${'b'.repeat(5000)}`,
			].join('\n'),
		},
	};
}

export function seed(store: ContextStore): Map<string, SeededSource> {
	const seeded = new Map<string, SeededSource>();

	for (const [name, source] of Object.entries(source_texts())) {
		const stored = store.store({
			text: source.text,
			tool_name: source.tool_name,
			input_summary: name,
			project_path: PROJECT,
			session_id: SESSION,
			force: true,
		});

		if (!stored) throw new Error(`Failed to seed ${name}`);
		seeded.set(name, {
			name,
			source_id: stored.source_id,
			first_chunk_id: stored.first_chunk_id,
		});
	}

	return seeded;
}

export function result_bytes(
	values: Array<{ content: string }>,
): number {
	return values.reduce(
		(total, value) =>
			total + Buffer.byteLength(value.content, 'utf8'),
		0,
	);
}
