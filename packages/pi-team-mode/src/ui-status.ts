import type {
	ExtensionCommandContext,
	ExtensionContext,
} from '@mariozechner/pi-coding-agent';
import {
	Container,
	Text,
	type SelectItem,
} from '@mariozechner/pi-tui';
import {
	show_picker_modal,
	show_text_modal,
} from '@spences10/pi-tui-modal';
import { format_status_counts } from './formatting.js';
import type { RpcTeammate } from './rpc-runner.js';
import {
	get_team_status,
	get_team_statuses,
} from './runner-orchestration.js';
import type { TeamStatus } from './store.js';
import { TeamStore } from './store.js';
import type { TeamUiMode, TeamUiStyle } from './team-tool-params.js';

export const TEAM_UI_ENV = 'MY_PI_TEAM_UI';
export const TEAM_UI_STYLE_ENV = 'MY_PI_TEAM_UI_STYLE';
export const STATUS_KEY = 'team';

export function get_team_ui_mode(): TeamUiMode {
	const value = process.env[TEAM_UI_ENV]?.trim().toLowerCase();
	if (!value) return 'compact';
	if (['0', 'false', 'no', 'off', 'hide'].includes(value))
		return 'off';
	if (['full', 'widget', 'on', 'true', '1'].includes(value))
		return 'full';
	if (['auto'].includes(value)) return 'auto';
	return 'compact';
}

export function get_team_ui_style(): TeamUiStyle {
	const value = process.env[TEAM_UI_STYLE_ENV]?.trim().toLowerCase();
	if (!value) return 'plain';
	if (['badge', 'badges', 'icon', 'icons'].includes(value))
		return 'badge';
	if (['color', 'colour', 'colors', 'colours'].includes(value))
		return 'color';
	return 'plain';
}

export function themed(
	ctx: ExtensionContext,
	color: 'accent' | 'dim' | 'muted' | 'warning',
	text: string,
): string {
	try {
		return ctx.ui.theme.fg(color, text);
	} catch {
		return text;
	}
}

export function format_team_footer_status(
	status: TeamStatus,
	style: TeamUiStyle,
): string {
	const fragments = [`team:${status.team.name}`];
	if (status.counts.blocked > 0) {
		fragments.push(
			style === 'badge'
				? `! ${status.counts.blocked} attention`
				: `${status.counts.blocked} attention`,
		);
	}
	if (status.counts.in_progress > 0) {
		fragments.push(
			style === 'badge'
				? `◐ ${status.counts.in_progress} running`
				: `${status.counts.in_progress} running`,
		);
	}
	if (status.counts.pending > 0) {
		fragments.push(
			style === 'badge'
				? `○ ${status.counts.pending} queued`
				: `${status.counts.pending} queued`,
		);
	}
	if (status.tasks.length === 0) {
		fragments.push('no tasks');
	} else {
		fragments.push(
			style === 'badge'
				? `✓ ${status.counts.completed}/${status.tasks.length} done`
				: `${status.counts.completed}/${status.tasks.length} done`,
		);
	}
	return fragments.join(' · ');
}

export function format_team_widget_lines(
	status: TeamStatus,
	style: TeamUiStyle,
): [string, string] {
	const header = `Team ${status.team.name}: ${status.members.length} member(s), ${status.tasks.length} task(s)`;
	if (style !== 'badge') {
		return [
			header,
			`${status.counts.blocked} attention • ${status.counts.in_progress} running • ${status.counts.pending} queued • ${status.counts.completed} done`,
		];
	}
	return [
		header,
		`! ${status.counts.blocked} attention • ◐ ${status.counts.in_progress} running • ○ ${status.counts.pending} queued • ✓ ${status.counts.completed} done`,
	];
}

export function color_team_count(
	theme: ExtensionContext['ui']['theme'],
	style: TeamUiStyle,
	kind: 'pending' | 'running' | 'blocked' | 'done' | 'text',
	text: string,
	active: boolean,
): string {
	if (style !== 'color') return theme.fg('dim', text);
	if (!active) return theme.fg('dim', text);
	switch (kind) {
		case 'pending':
			return theme.fg('warning', text);
		case 'running':
			return theme.fg('accent', text);
		case 'blocked':
			return theme.fg('warning', text);
		case 'done':
			return theme.fg('success', text);
		case 'text':
			return theme.fg('accent', text);
	}
}

export function render_team_widget_lines(
	theme: ExtensionContext['ui']['theme'],
	status: TeamStatus,
	style: TeamUiStyle,
): [string, string] {
	const [header, counts] = format_team_widget_lines(status, style);
	if (style !== 'color') {
		return [theme.fg('dim', header), theme.fg('dim', counts)];
	}
	return [
		color_team_count(theme, style, 'text', header, true),
		[
			color_team_count(
				theme,
				style,
				'blocked',
				`${status.counts.blocked} attention`,
				status.counts.blocked > 0,
			),
			color_team_count(
				theme,
				style,
				'running',
				`${status.counts.in_progress} running`,
				status.counts.in_progress > 0,
			),
			color_team_count(
				theme,
				style,
				'pending',
				`${status.counts.pending} queued`,
				status.counts.pending > 0,
			),
			color_team_count(
				theme,
				style,
				'done',
				`${status.counts.completed} done`,
				status.counts.completed > 0,
			),
		].join(theme.fg('dim', ' • ')),
	];
}

export function should_show_team_widget(
	status: TeamStatus,
	mode: TeamUiMode,
): boolean {
	if (mode === 'off' || mode === 'compact') return false;
	const has_actionable_counts =
		status.counts.pending > 0 ||
		status.counts.in_progress > 0 ||
		status.counts.blocked > 0;
	const has_non_idle_teammates = status.members.some(
		(member) => member.role !== 'lead' && member.status !== 'idle',
	);
	if (mode === 'auto') return has_actionable_counts;
	return (
		has_actionable_counts ||
		has_non_idle_teammates ||
		status.tasks.length > 0
	);
}

export async function show_team_switcher(
	ctx: ExtensionCommandContext,
	store: TeamStore,
	active_team_id: string | undefined,
): Promise<string | undefined> {
	const statuses = await get_team_statuses(store);
	if (statuses.length === 0) {
		ctx.ui.notify(
			'No teams yet. Create one with /team create [name].',
		);
		return undefined;
	}

	const items: SelectItem[] = statuses.map((status) => ({
		value: status.team.id,
		label: `${status.team.id === active_team_id ? '● ' : ''}${status.team.name}`,
		description: `${format_status_counts(status)} • ${status.team.cwd}`,
	}));
	const active_index = statuses.findIndex(
		(status) => status.team.id === active_team_id,
	);

	return await show_picker_modal(ctx, {
		title: 'Teams',
		subtitle: `${statuses.length} saved team(s)`,
		items,
		initial_index: active_index >= 0 ? active_index : undefined,
		footer: 'enter switches team • esc back',
	});
}

export async function show_team_text_modal(
	ctx: ExtensionCommandContext,
	options: {
		title: string;
		subtitle?: string;
		text: string;
	},
): Promise<void> {
	await show_text_modal(ctx, {
		title: options.title,
		subtitle: options.subtitle,
		text: options.text,
		max_visible_lines: 20,
		overlay_options: { width: '90%', minWidth: 72 },
	});
}

export function has_modal_ui(ctx: ExtensionContext): boolean {
	return ctx.hasUI && process.env.MY_PI_RUNTIME_MODE !== 'rpc';
}

export function set_team_ui(
	ctx: ExtensionContext,
	store: TeamStore,
	team_id: string | undefined,
	runners: Map<string, RpcTeammate> = new Map(),
): void {
	if (!ctx.hasUI) return;
	if (!team_id || get_team_ui_mode() === 'off') {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		ctx.ui.setWidget(STATUS_KEY, undefined);
		return;
	}
	void (async () => {
		try {
			const status = await get_team_status(store, team_id, runners);
			const style = get_team_ui_style();
			const mode = get_team_ui_mode();
			const show_widget = should_show_team_widget(status, mode);
			const footer =
				mode === 'full' && show_widget
					? `team:${status.team.name}`
					: format_team_footer_status(status, style);
			ctx.ui.setStatus(STATUS_KEY, themed(ctx, 'dim', footer));

			if (!show_widget) {
				ctx.ui.setWidget(STATUS_KEY, undefined);
				return;
			}

			ctx.ui.setWidget(
				STATUS_KEY,
				(_tui, theme) => {
					const container = new Container();
					const [header, counts] = render_team_widget_lines(
						theme,
						status,
						style,
					);
					container.addChild(new Text(header, 0, 0));
					container.addChild(new Text(counts, 0, 0));
					return container;
				},
				{ placement: 'belowEditor' },
			);
		} catch {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			ctx.ui.setWidget(STATUS_KEY, undefined);
		}
	})();
}
