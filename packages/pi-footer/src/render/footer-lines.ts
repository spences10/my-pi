import type {
	ExtensionContext,
	ReadonlyFooterDataProvider,
} from '@earendil-works/pi-coding-agent';
import {
	truncateToWidth,
	visibleWidth,
} from '@earendil-works/pi-tui';
import {
	build_footer_model,
	type FooterModel,
} from '../model/footer-model.js';
import type {
	FooterState,
	FooterStatusPlacement,
} from '../presets/types.js';
import {
	muted,
	themed_text,
	type FooterTheme,
} from '../theme/tokens.js';
import { sanitize_status_text } from '../utils/text.js';
import {
	render_footer_status_line,
	render_footer_three_column_line,
} from './status-line.js';

interface StatusRow {
	left: string[];
	center: string[];
	right: string[];
}

function enabled_items(
	items: Array<[string, boolean | undefined]>,
): string[] {
	return items
		.filter(([text, enabled]) => enabled && Boolean(text))
		.map(([text]) => text);
}

function render_stats_line(
	model: FooterModel,
	theme: FooterTheme,
	state: FooterState,
	width: number,
): string | undefined {
	const stats_left = enabled_items([
		[model.token_parts.join(' '), state.widgets.tokens],
		[
			model.cost_text ?? '',
			state.widgets.cost && Boolean(model.cost_text),
		],
		[model.context_text, state.widgets.context],
	]).join(' ');
	const right_parts = enabled_items([
		[model.model_name, state.widgets.model],
		[
			model.thinking_text ?? '',
			state.widgets.thinking && Boolean(model.thinking_text),
		],
	]);
	const right_side = right_parts.join(' • ');
	if (!stats_left && !right_side) return undefined;

	let left = stats_left;
	let left_width = visibleWidth(left);
	if (left_width > width) {
		left = truncateToWidth(left, width, '...');
		left_width = visibleWidth(left);
	}
	if (!right_side) return themed_text(theme, state.tone, left);
	if (!left) {
		return truncateToWidth(
			themed_text(theme, state.tone, right_side),
			width,
			muted(theme, '...'),
		);
	}

	const right_width = visibleWidth(right_side);
	const available_for_right = Math.max(0, width - left_width - 2);
	const rendered_right =
		left_width + 2 + right_width <= width
			? right_side
			: truncateToWidth(right_side, available_for_right, '');
	const gap = Math.max(
		1,
		width - left_width - visibleWidth(rendered_right),
	);
	return (
		themed_text(theme, state.tone, left) +
		' '.repeat(gap) +
		themed_text(theme, state.tone, rendered_right)
	);
}

function render_status_label(
	key: string,
	text: string,
	state: FooterState,
): string {
	const sanitized = sanitize_status_text(text);
	if (state.status_label_mode === 'never') return sanitized;
	if (state.status_label_mode === 'always')
		return `${key}:${sanitized}`;
	if (sanitized.toLowerCase().startsWith(key.toLowerCase()))
		return sanitized;
	return `${key}:${sanitized}`;
}

function prioritized_statuses(
	statuses: Map<string, string>,
): Array<[string, string]> {
	const priority = [
		'harness',
		'mcp',
		'team',
		'lsp',
		'recall',
		'nopeek',
		'codex-usage',
	];
	return Array.from(statuses.entries()).sort(([a], [b]) => {
		const a_index = priority.indexOf(a);
		const b_index = priority.indexOf(b);
		if (a_index !== -1 || b_index !== -1) {
			return (
				(a_index === -1 ? 99 : a_index) -
				(b_index === -1 ? 99 : b_index)
			);
		}
		return a.localeCompare(b);
	});
}

function status_placement(
	key: string,
	state: FooterState,
): FooterStatusPlacement {
	return (
		state.status_layout[key] ?? {
			row: 1,
			alignment: 'left',
			hidden: false,
		}
	);
}

function add_status(
	rows: Map<number, StatusRow>,
	placement: FooterStatusPlacement,
	text: string,
): void {
	if (placement.hidden) return;
	const row = rows.get(placement.row) ?? {
		left: [],
		center: [],
		right: [],
	};
	row[placement.alignment].push(text);
	rows.set(placement.row, row);
}

function build_status_rows(
	model: FooterModel,
	state: FooterState,
): Map<number, StatusRow> {
	const rows = new Map<number, StatusRow>();
	if (state.widgets.statuses) {
		for (const [key, text] of prioritized_statuses(model.statuses)) {
			add_status(
				rows,
				status_placement(key, state),
				render_status_label(key, text, state),
			);
		}
	}
	if (state.widgets.preset && model.preset_status) {
		add_status(
			rows,
			status_placement('preset', state),
			sanitize_status_text(model.preset_status),
		);
	}
	return rows;
}

function render_status_row(
	theme: FooterTheme,
	state: FooterState,
	width: number,
	row: StatusRow,
): string | undefined {
	return render_footer_three_column_line(
		theme,
		width,
		row.left,
		row.center,
		row.right,
		state.tone,
	);
}

function render_path_line(
	model: FooterModel,
	theme: FooterTheme,
	state: FooterState,
	width: number,
): string | undefined {
	const left = enabled_items([
		[model.path_text, state.widgets.path],
		[
			model.git_text ? `(${model.git_text})` : '',
			state.widgets.git && Boolean(model.git_text),
		],
	]);
	const right = state.widgets.session
		? model.session_text
		: undefined;
	return render_footer_status_line(
		theme,
		width,
		left,
		right,
		state.tone,
	);
}

function compact_items(
	model: FooterModel,
	state: FooterState,
): string[] {
	return enabled_items([
		[model.path_text, state.widgets.path],
		[
			model.git_text ? `(${model.git_text})` : '',
			state.widgets.git && Boolean(model.git_text),
		],
		[model.session_text ?? '', state.widgets.session],
		[model.token_parts.join(' '), state.widgets.tokens],
		[model.cost_text ?? '', state.widgets.cost],
		[model.context_text, state.widgets.context],
		[model.model_name, state.widgets.model],
		[model.thinking_text ?? '', state.widgets.thinking],
	]);
}

export function render_footer_lines(
	ctx: ExtensionContext,
	theme: FooterTheme,
	footer_data: ReadonlyFooterDataProvider,
	state: FooterState,
	width: number,
): string[] {
	const model = build_footer_model(
		ctx,
		footer_data,
		theme,
		state.git_icon_mode,
	);
	const status_rows = build_status_rows(model, state);

	if (state.density === 'compact' || state.preset === 'minimal') {
		const first_status_row = status_rows.get(
			Math.min(...status_rows.keys()),
		) ?? { left: [], center: [], right: [] };
		const compact = render_footer_three_column_line(
			theme,
			width,
			[...compact_items(model, state), ...first_status_row.left],
			first_status_row.center,
			first_status_row.right,
			state.tone,
		);
		return compact ? [compact] : [];
	}

	const lines: string[] = [];
	const path_line = render_path_line(model, theme, state, width);
	const stats_line = render_stats_line(model, theme, state, width);
	const rendered_status_rows = Array.from(status_rows.entries())
		.sort(([a], [b]) => a - b)
		.map(([, row]) => render_status_row(theme, state, width, row))
		.filter((line): line is string => Boolean(line));

	if (path_line)
		lines.push(
			truncateToWidth(path_line, width, muted(theme, '...')),
		);
	if (stats_line)
		lines.push(
			truncateToWidth(stats_line, width, muted(theme, '...')),
		);
	lines.push(...rendered_status_rows);

	if (state.density === 'expanded' || state.preset === 'power') {
		const footer_mode = themed_text(
			theme,
			state.tone,
			`footer:${state.preset} density:${state.density}`,
		);
		lines.push(
			truncateToWidth(footer_mode, width, muted(theme, '...')),
		);
	}

	return lines;
}
