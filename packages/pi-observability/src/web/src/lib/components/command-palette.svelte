<script lang="ts">
	import { api, type DashboardEvent } from '#lib/api.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Command from '#lib/components/ui/command/index.js';
	import { Kbd } from '#lib/components/ui/kbd/index.js';
	import { event_summary, type_label } from '#lib/events.js';
	import {
		relative_time,
		repo_name,
		session_title,
		short_id,
		tool_label,
	} from '#lib/format.js';
	import { live } from '#lib/live.svelte.js';
	import { range, RANGES } from '#lib/range.svelte.js';
	import { recent_sessions } from '#lib/recent-sessions.svelte.js';
	import { href, session_href } from '#lib/router.js';
	import { router } from '#lib/router.svelte.js';
	import { theme } from '#lib/theme.svelte.js';
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
	import ListIcon from '@lucide/svelte/icons/list';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PlayIcon from '@lucide/svelte/icons/play';
	import SearchIcon from '@lucide/svelte/icons/search';
	import SunIcon from '@lucide/svelte/icons/sun';
	import TextSearchIcon from '@lucide/svelte/icons/text-search';
	import WrenchIcon from '@lucide/svelte/icons/wrench';
	import type { FailureRow } from '../../../../types';

	const SEARCH_DELAY_MS = 150;
	const MIN_SEARCH_CHARS = 2;

	let open = $state(false);
	let query = $state('');
	let failures = $state.raw<FailureRow[]>([]);
	let event_hits = $state.raw<DashboardEvent[]>([]);
	let searching = $state(false);
	let search_timer: ReturnType<typeof setTimeout> | null = null;
	let search_id = 0;

	const needle = $derived(query.trim().toLowerCase());
	const matches = (...values: (string | null | undefined)[]) =>
		!needle ||
		values.some((value) => value?.toLowerCase().includes(needle));

	const sessions = $derived(
		recent_sessions.list
			.filter((session) =>
				matches(
					session_title(session),
					repo_name(session),
					session.session_id,
					session.model,
				),
			)
			.slice(0, needle ? 8 : 5),
	);
	const failure_matches = $derived(
		failures
			.filter((failure) =>
				matches(
					failure.name,
					failure.error_text,
					session_title(failure),
				),
			)
			.slice(0, needle ? 6 : 3),
	);
	const current_session = $derived(
		router.route.name === 'session' ? router.route.id : null,
	);

	// Opening loads the latest failures once; sessions are already
	// kept fresh by the sidebar.
	function set_open(value: boolean): void {
		open = value;
		if (!value) return;
		api
			.failures(null, 30)
			.then((response) => (failures = response.failures))
			.catch(() => (failures = []));
	}

	// Typing schedules the event search directly, rather than an effect
	// watching the query.
	function set_query(value: string): void {
		query = value;
		if (search_timer) clearTimeout(search_timer);
		const text = value.trim();
		const id = ++search_id;
		if (text.length < MIN_SEARCH_CHARS) {
			event_hits = [];
			searching = false;
			return;
		}
		searching = true;
		search_timer = setTimeout(() => {
			api
				.search_events(text)
				.then((response) => {
					if (id === search_id) event_hits = response.events;
				})
				.catch(() => {
					if (id === search_id) event_hits = [];
				})
				.finally(() => {
					if (id === search_id) searching = false;
				});
		}, SEARCH_DELAY_MS);
	}

	function go(target: string): void {
		set_open(false);
		router.navigate(target);
	}

	function run(action: () => void): void {
		set_open(false);
		action();
	}

	// Tool events open their span in the trace; others open the
	// session's event list.
	function event_href(event: DashboardEvent): string {
		const call_id = event.payload?.toolCallId;
		return typeof call_id === 'string'
			? session_href(event.session_id, 'trace', `tool:${call_id}`)
			: session_href(event.session_id, 'events');
	}

	function handle_keydown(event: KeyboardEvent): void {
		if (
			(event.metaKey || event.ctrlKey) &&
			event.key.toLowerCase() === 'k'
		) {
			event.preventDefault();
			set_open(!open);
		}
	}

	const pages = [
		{
			name: 'overview',
			label: 'Overview',
			icon: LayoutDashboardIcon,
		},
		{ name: 'sessions', label: 'Sessions', icon: ListIcon },
		{ name: 'tools', label: 'Tools', icon: WrenchIcon },
	] as const;
	const themes = [
		{ mode: 'light', label: 'Light theme', icon: SunIcon },
		{ mode: 'dark', label: 'Dark theme', icon: MoonIcon },
		{ mode: 'system', label: 'System theme', icon: MonitorIcon },
	] as const;
</script>

<svelte:window onkeydown={handle_keydown} />

<Button
	variant="outline"
	class="w-full max-w-sm justify-start text-muted-foreground"
	onclick={() => set_open(true)}
>
	<SearchIcon />
	<span class="truncate">Search sessions, failures, events</span>
	<Kbd class="ml-auto hidden sm:inline-flex">⌘K</Kbd>
</Button>

<Command.Dialog
	bind:open={() => open, set_open}
	shouldFilter={false}
	class="sm:max-w-2xl"
	title="Command palette"
	description="Go to a view, session, or failure, search events, or run an action"
>
	<Command.Input
		bind:value={() => query, set_query}
		placeholder="Search sessions, failures, events…"
	/>
	<Command.List class="max-h-[min(60vh,32rem)]">
		<Command.Empty>
			{searching ? 'Searching events…' : 'Nothing matches that.'}
		</Command.Empty>

		{#if !needle}
			<Command.Group heading="Go to">
				{#each pages as page (page.name)}
					<Command.Item
						value={`page:${page.name}`}
						onSelect={() => go(href({ name: page.name }))}
					>
						<page.icon />
						{page.label}
					</Command.Item>
				{/each}
			</Command.Group>
		{/if}

		{#if sessions.length > 0}
			<Command.Group heading="Sessions">
				{#each sessions as session (session.session_id)}
					<Command.Item
						value={`session:${session.session_id}`}
						onSelect={() => go(session_href(session.session_id))}
					>
						<ActivityIcon />
						<div class="flex min-w-0 flex-1 flex-col">
							<span class="truncate">{session_title(session)}</span>
							<span class="truncate text-xs text-muted-foreground">
								{repo_name(session)} · {session.model ??
									'unknown model'}
							</span>
						</div>
						<span class="shrink-0 text-xs text-muted-foreground">
							{live.is_active(session.session_id, session.last_ts)
								? 'live'
								: relative_time(session.last_ts, live.now)}
						</span>
					</Command.Item>
				{/each}
			</Command.Group>
		{/if}

		{#if failure_matches.length > 0}
			<Command.Group heading="Recent failures">
				{#each failure_matches as failure (`${failure.session_id}:${failure.ts}:${failure.span_id}`)}
					<Command.Item
						value={`failure:${failure.session_id}:${failure.ts}`}
						onSelect={() =>
							go(
								session_href(
									failure.session_id,
									'trace',
									failure.span_id,
								),
							)}
					>
						<CircleAlertIcon class="text-destructive" />
						<div class="flex min-w-0 flex-1 flex-col">
							<span class="truncate font-mono text-xs">
								{failure.kind === 'tool'
									? tool_label(failure.name)
									: failure.name}
								{#if failure.exit_code != null}· exit {failure.exit_code}{/if}
							</span>
							<span class="truncate text-xs text-muted-foreground">
								{failure.error_text?.trim().split('\n')[0] ??
									'No error output recorded.'}
							</span>
						</div>
						<span class="shrink-0 text-xs text-muted-foreground">
							{relative_time(failure.ts, live.now)}
						</span>
					</Command.Item>
				{/each}
			</Command.Group>
		{/if}

		{#if event_hits.length > 0}
			<Command.Group heading="Events">
				{#each event_hits as event (event.event_id)}
					<Command.Item
						value={`event:${event.event_id}`}
						onSelect={() => go(event_href(event))}
					>
						<TextSearchIcon />
						<div class="flex min-w-0 flex-1 flex-col">
							<span class="truncate">
								{type_label(event.type)}
								<span class="text-muted-foreground">
									· {short_id(event.session_id)}</span
								>
							</span>
							<span
								class="truncate font-mono text-xs text-muted-foreground"
							>
								{event_summary(event) || '—'}
							</span>
						</div>
						<span class="shrink-0 text-xs text-muted-foreground">
							{relative_time(event.ts, live.now)}
						</span>
					</Command.Item>
				{/each}
			</Command.Group>
		{/if}

		{#if !needle || matches('theme', 'range', 'pause', 'resume', 'live', 'copy', 'days', 'hours')}
			<Command.Separator />
			<Command.Group heading="Actions">
				{#if current_session}
					<Command.Item
						value="copy-session-id"
						onSelect={() =>
							run(() => {
								void navigator.clipboard
									.writeText(current_session)
									.catch(() => {});
							})}
					>
						<CopyIcon /> Copy session id
					</Command.Item>
				{/if}
				<Command.Item
					value="toggle-live"
					onSelect={() => run(() => live.toggle_paused())}
				>
					{#if live.paused}<PlayIcon /> Resume live updates{:else}<PauseIcon
						/> Pause live updates{/if}
				</Command.Item>
				{#each themes.filter((item) => item.mode !== theme.mode) as item (item.mode)}
					<Command.Item
						value={`theme:${item.mode}`}
						onSelect={() => run(() => theme.set(item.mode))}
					>
						<item.icon />
						{item.label}
					</Command.Item>
				{/each}
				{#each RANGES.filter((option) => option.key !== range.key) as option (option.key)}
					<Command.Item
						value={`range:${option.key}`}
						onSelect={() => run(() => range.set(option.key))}
					>
						<CalendarIcon /> Show {option.label.toLowerCase()}
					</Command.Item>
				{/each}
			</Command.Group>
		{/if}
	</Command.List>
</Command.Dialog>
