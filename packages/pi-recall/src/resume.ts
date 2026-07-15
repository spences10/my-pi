import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import {
	Input,
	truncateToWidth,
	visibleWidth,
	type KeybindingsManager,
} from '@earendil-works/pi-tui';
import { existsSync } from 'node:fs';
import {
	RESUMABLE_API_CAPABILITIES,
	RESUMABLE_API_SCHEMA_VERSION,
	list_resumable_sessions,
	type ResumableSession,
} from 'pirecall/resumable';

const PAGE_SIZE = 50;
const MAX_VISIBLE = 12;
const SEARCH_DEBOUNCE_MS = 120;
const REQUIRED_CAPABILITIES = [
	'archive-preserving-source-liveness',
	'cwd-scope',
	'server-side-search',
	'pagination',
] as const;

interface PickerResult {
	path?: string;
	error?: string;
}

export function supports_resumable_contract(result: {
	schema_version: number;
	capabilities: readonly string[];
}): boolean {
	return (
		result.schema_version === RESUMABLE_API_SCHEMA_VERSION &&
		REQUIRED_CAPABILITIES.every((capability) =>
			result.capabilities.includes(capability),
		)
	);
}

function relative_age(timestamp: string, now = Date.now()): string {
	const elapsed = Math.max(0, now - new Date(timestamp).getTime());
	const minutes = Math.floor(elapsed / 60_000);
	if (minutes < 1) return 'now';
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d`;
	return `${Math.floor(days / 30)}mo`;
}

function compact_title(session: ResumableSession): string {
	const raw_title =
		session.name?.trim() || session.first_message || session.id;
	const title = raw_title.replace(/\s+/g, ' ').trim();
	return title.length > 100 ? `${title.slice(0, 97)}…` : title;
}

export function format_resumable_session(
	session: ResumableSession,
	index: number,
): string {
	const date = new Date(session.modified_at);
	const modified = Number.isNaN(date.getTime())
		? session.modified_at
		: date.toLocaleString();
	return `${index + 1}. ${compact_title(session)} · ${modified} · ${session.cwd || session.path}`;
}

function show_native_fallback(
	ctx: ExtensionCommandContext,
	message: string,
): void {
	ctx.ui.notify(
		`${message} Run /resume to use Pi's native picker.`,
		'warning',
	);
}

function matches(
	keybindings: KeybindingsManager,
	data: string,
	action:
		| 'tui.select.up'
		| 'tui.select.down'
		| 'tui.select.pageUp'
		| 'tui.select.pageDown'
		| 'tui.select.confirm'
		| 'tui.select.cancel'
		| 'tui.input.tab'
		| 'app.session.togglePath',
): boolean {
	return keybindings.matches(data, action);
}

async function show_recall_resume_picker(
	initial_query: string,
	ctx: ExtensionCommandContext,
): Promise<PickerResult | undefined> {
	return await ctx.ui.custom<PickerResult | undefined>(
		(tui, theme, keybindings, done) => {
			const search_input = new Input();
			search_input.setValue(initial_query);
			let scope: 'project' | 'all' = 'project';
			let sessions: ResumableSession[] = [];
			let selected_index = 0;
			let loading = false;
			let has_more = false;
			let show_path = false;
			let status = 'Loading sessions…';
			let request_sequence = 0;
			let search_timer: NodeJS.Timeout | undefined;

			const finish = (result?: PickerResult): void => {
				if (search_timer) clearTimeout(search_timer);
				done(result);
			};

			const load = async (append = false): Promise<void> => {
				if (loading && append) return;
				const sequence = ++request_sequence;
				loading = true;
				status = append ? 'Loading more…' : 'Searching…';
				tui.requestRender();
				try {
					const result = await list_resumable_sessions({
						scope,
						cwd: scope === 'project' ? ctx.cwd : undefined,
						query: search_input.getValue().trim() || undefined,
						limit: PAGE_SIZE,
						offset: append ? sessions.length : 0,
					});
					if (sequence !== request_sequence) return;
					if (!supports_resumable_contract(result)) {
						finish({
							error: 'Pirecall has an incompatible resumable API.',
						});
						return;
					}
					sessions = append
						? [...sessions, ...result.sessions]
						: result.sessions;
					selected_index = Math.min(
						selected_index,
						Math.max(0, sessions.length - 1),
					);
					has_more = result.sessions.length === PAGE_SIZE;
					status = sessions.length
						? `${sessions.length}${has_more ? '+' : ''} live sessions`
						: 'No matching live sessions';
				} catch (error) {
					if (sequence !== request_sequence) return;
					finish({
						error: `Pirecall is unavailable: ${error instanceof Error ? error.message : String(error)}.`,
					});
				} finally {
					if (sequence === request_sequence) loading = false;
					tui.requestRender();
				}
			};

			const schedule_search = (): void => {
				if (search_timer) clearTimeout(search_timer);
				search_timer = setTimeout(() => {
					selected_index = 0;
					void load();
				}, SEARCH_DEBOUNCE_MS);
			};

			void load();
			return {
				render: (width: number) => {
					const scope_label =
						scope === 'project' ? 'Current Folder' : 'All Sessions';
					const heading = 'Resume with Recall';
					const scope_status = `● ${scope_label} · ${sessions.length}${has_more ? '+' : ''} live`;
					const heading_gap = ' '.repeat(
						Math.max(
							1,
							width -
								visibleWidth(heading) -
								visibleWidth(scope_status),
						),
					);
					const lines = [
						`${theme.fg('accent', theme.bold(heading))}${heading_gap}${theme.fg('accent', scope_status)}`,
						theme.fg(
							'dim',
							'tab scope · ctrl+p path · ↑↓ navigate · page up/down · enter resume · esc cancel',
						),
						'',
						...search_input.render(width),
						'',
					];
					const start = Math.max(
						0,
						selected_index - Math.floor(MAX_VISIBLE / 2),
					);
					const visible = sessions.slice(start, start + MAX_VISIBLE);
					for (const [offset, session] of visible.entries()) {
						const index = start + offset;
						const selected = index === selected_index;
						const prefix = `${selected ? '›' : ' '} ${session.parent_session_path ? '↳ ' : ''}`;
						const right = `${session.message_count}  ${relative_age(session.modified_at)}`;
						const available = Math.max(
							8,
							width - visibleWidth(prefix) - visibleWidth(right) - 1,
						);
						const title = truncateToWidth(
							compact_title(session),
							available,
						);
						const gap = ' '.repeat(
							Math.max(
								1,
								width -
									visibleWidth(prefix) -
									visibleWidth(title) -
									visibleWidth(right),
							),
						);
						const title_color = session.name ? 'accent' : 'text';
						const line = `${prefix}${theme.fg(title_color, title)}${gap}${theme.fg('dim', right)}`;
						lines.push(
							selected ? theme.bg('selectedBg', line) : line,
						);
					}
					if (visible.length === 0)
						lines.push(theme.fg('dim', status));
					const selected = sessions[selected_index];
					lines.push(
						'',
						theme.fg('dim', loading ? 'Working…' : status),
					);
					if (selected) {
						const prompt = selected.first_message
							.replace(/\s+/g, ' ')
							.trim();
						lines.push(
							theme.fg(
								'muted',
								truncateToWidth(`Prompt: ${prompt}`, width),
							),
						);
						if (show_path) {
							lines.push(
								theme.fg(
									'dim',
									truncateToWidth(`Path: ${selected.path}`, width),
								),
							);
						}
					}
					return lines;
				},
				invalidate: () => search_input.invalidate(),
				handleInput: (data: string) => {
					if (matches(keybindings, data, 'tui.select.up')) {
						selected_index = Math.max(0, selected_index - 1);
					} else if (matches(keybindings, data, 'tui.select.down')) {
						selected_index = Math.min(
							Math.max(0, sessions.length - 1),
							selected_index + 1,
						);
						if (
							has_more &&
							!loading &&
							selected_index >= sessions.length - 1
						)
							void load(true);
					} else if (
						matches(keybindings, data, 'tui.select.pageUp')
					) {
						selected_index = Math.max(
							0,
							selected_index - MAX_VISIBLE,
						);
					} else if (
						matches(keybindings, data, 'tui.select.pageDown')
					) {
						selected_index = Math.min(
							Math.max(0, sessions.length - 1),
							selected_index + MAX_VISIBLE,
						);
						if (has_more && !loading) void load(true);
					} else if (
						matches(keybindings, data, 'tui.select.confirm')
					) {
						const selected = sessions[selected_index];
						if (selected) finish({ path: selected.path });
					} else if (
						matches(keybindings, data, 'tui.select.cancel')
					) {
						finish();
					} else if (matches(keybindings, data, 'tui.input.tab')) {
						scope = scope === 'project' ? 'all' : 'project';
						selected_index = 0;
						void load();
					} else if (
						matches(keybindings, data, 'app.session.togglePath')
					) {
						show_path = !show_path;
					} else {
						search_input.handleInput(data);
						schedule_search();
					}
					tui.requestRender();
				},
			};
		},
	);
}

export async function run_recall_resume(
	initial_query: string,
	ctx: ExtensionCommandContext,
): Promise<void> {
	if (!ctx.hasUI) {
		show_native_fallback(
			ctx,
			'The recall picker requires interactive mode.',
		);
		return;
	}

	const result = await show_recall_resume_picker(
		initial_query.trim(),
		ctx,
	);
	if (!result) return;
	if (result.error) {
		show_native_fallback(ctx, result.error);
		return;
	}
	if (!result.path) return;
	if (!existsSync(result.path)) {
		ctx.ui.notify(
			'That session file is no longer available. Refreshing pirecall; use /resume if it persists.',
			'warning',
		);
		return;
	}
	await ctx.switchSession(result.path);
}

export const resumable_contract = {
	schema_version: RESUMABLE_API_SCHEMA_VERSION,
	capabilities: RESUMABLE_API_CAPABILITIES,
};
