<script lang="ts">
	import { api } from '#lib/api.js';
	import TurnTimeChart from '#lib/charts/turn-time-chart.svelte';
	import CopyButton from '#lib/components/copy-button.svelte';
	import StatTile from '#lib/components/stat-tile.svelte';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Breadcrumb from '#lib/components/ui/breadcrumb/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import {
		date_time,
		duration,
		money,
		number_crunch,
		percent,
		repo_name,
		session_title,
		short_id,
	} from '#lib/format.js';
	import { live } from '#lib/live.svelte.js';
	import { resource } from '#lib/resource.svelte.js';
	import {
		href,
		session_href,
		type SessionTab,
	} from '#lib/router.js';
	import { router } from '#lib/router.svelte.js';
	import ContextTab from './session/context-tab.svelte';
	import EventsTab from './session/events-tab.svelte';
	import ToolsTab from './session/tools-tab.svelte';
	import TurnsTab from './session/turns-tab.svelte';

	let { id, tab }: { id: string; tab: SessionTab } = $props();

	const detail = resource(async () => {
		void live.session_revision(id);
		const [trace, spans, events] = await Promise.all([
			api.trace(id),
			api.spans(id),
			api.events(id),
		]);
		return { trace, spans, events: events.events };
	});

	const session = $derived(detail.data?.trace.session ?? null);
	const metrics = $derived(detail.data?.trace.metrics);
	const turns = $derived(detail.data?.spans.turns ?? []);
	const tools = $derived(detail.data?.spans.tools ?? []);
	const events = $derived(detail.data?.events ?? []);
	const active = $derived(live.is_active(id, session?.last_ts));
	const model_ms = $derived(
		turns.reduce((sum, turn) => sum + (turn.provider_ms ?? 0), 0),
	);
	const tool_ms = $derived(
		turns.reduce((sum, turn) => sum + (turn.tool_ms ?? 0), 0),
	);
	const turn_ms = $derived(
		turns.reduce((sum, turn) => sum + turn.duration_ms, 0),
	);
	const partial = $derived(
		session && session.event_count > events.length,
	);

	function select_tab(value: string): void {
		router.navigate(session_href(id, value as SessionTab), {
			replace: true,
		});
	}
</script>

<div
	class={[
		'grid gap-4 transition-opacity',
		detail.loading && detail.data && 'opacity-70',
	]}
>
	<Breadcrumb.Root>
		<Breadcrumb.List>
			<Breadcrumb.Item>
				<Breadcrumb.Link href={href({ name: 'sessions' })}
					>Sessions</Breadcrumb.Link
				>
			</Breadcrumb.Item>
			<Breadcrumb.Separator />
			<Breadcrumb.Item
				>{session ? repo_name(session) : '…'}</Breadcrumb.Item
			>
			<Breadcrumb.Separator />
			<Breadcrumb.Item>
				<Breadcrumb.Page>{short_id(id)}</Breadcrumb.Page>
			</Breadcrumb.Item>
		</Breadcrumb.List>
	</Breadcrumb.Root>

	{#if detail.error}
		<Alert.Root variant="destructive">
			<Alert.Title>Could not load this session</Alert.Title>
			<Alert.Description>{detail.error}</Alert.Description>
		</Alert.Root>
	{/if}

	{#if !detail.data || !metrics}
		{#if !detail.error}
			<Skeleton class="h-16 rounded-xl" />
			<div
				class="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6"
			>
				{#each { length: 6 } as _, index (index)}
					<Skeleton class="h-24 rounded-xl" />
				{/each}
			</div>
			<Skeleton class="h-72 rounded-xl" />
		{/if}
	{:else}
		<header class="flex flex-wrap items-start gap-x-4 gap-y-2">
			<div class="min-w-0 flex-1">
				<h2 class="flex items-center gap-1 text-2xl">
					<span class="truncate"
						>{session ? session_title(session) : short_id(id)}</span
					>
					<CopyButton value={id} label="Copy session id" />
				</h2>
				<p class="truncate font-mono text-xs text-muted-foreground">
					{session?.cwd}
				</p>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				{#if active}
					<Badge variant="outline" class="gap-1.5"
						><span class="size-1.5 rounded-full bg-success"
						></span>Live</Badge
					>
				{:else}
					<Badge variant="secondary"
						>Ended {date_time(session?.last_ts)}</Badge
					>
				{/if}
				{#if session?.model}<Badge variant="outline" class="font-mono"
						>{session.model}</Badge
					>{/if}
				{#each session?.tags ?? [] as tag (tag)}
					<Badge variant="secondary">{tag}</Badge>
				{/each}
			</div>
		</header>

		<section
			class="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6"
			aria-label="Session totals"
		>
			<StatTile label="Cost" value={money(metrics.cost_usd)} />
			<StatTile
				label="Tokens"
				value={number_crunch(
					metrics.input_tokens + metrics.output_tokens,
				)}
				detail="{number_crunch(metrics.total_tokens)} including cache"
			/>
			<StatTile
				label="Turns"
				value={String(metrics.turns)}
				detail="{duration(metrics.elapsed_ms)} elapsed"
			/>
			<StatTile
				label="Tool calls"
				value={String(metrics.tool_calls)}
				detail={metrics.tool_failures > 0
					? `${metrics.tool_failures} failed`
					: 'None failed'}
				tone={metrics.tool_failures > 0 ? 'destructive' : 'default'}
			/>
			<StatTile
				label="Model time"
				value={duration(model_ms)}
				detail="{percent(model_ms, turn_ms)} of turn time"
			/>
			<StatTile
				label="Tool time"
				value={duration(tool_ms)}
				detail="{percent(tool_ms, turn_ms)} of turn time"
			/>
		</section>

		{#if turns.length > 0}
			<Card.Root>
				<Card.Header>
					<Card.Title>Where each turn's time went</Card.Title>
					<Card.Description>
						Model response, tool execution, and everything else, per
						turn
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<TurnTimeChart {turns} />
				</Card.Content>
			</Card.Root>
		{/if}

		<Card.Root class="pb-0">
			<Tabs.Root value={tab} onValueChange={select_tab}>
				<div class="flex flex-wrap items-center gap-2 px-4">
					<Tabs.List>
						<Tabs.Trigger value="turns"
							>Turns <span class="text-muted-foreground"
								>{turns.length}</span
							></Tabs.Trigger
						>
						<Tabs.Trigger value="tools"
							>Tools <span class="text-muted-foreground"
								>{tools.length}</span
							></Tabs.Trigger
						>
						<Tabs.Trigger value="events"
							>Events <span class="text-muted-foreground"
								>{events.length}</span
							></Tabs.Trigger
						>
						<Tabs.Trigger value="context">Context</Tabs.Trigger>
					</Tabs.List>
					{#if partial}
						<span class="ml-auto text-xs text-muted-foreground">
							Showing the latest {events.length} of {session?.event_count}
							events
						</span>
					{/if}
				</div>
				<Tabs.Content value="turns" class="pt-2"
					><TurnsTab {turns} /></Tabs.Content
				>
				<Tabs.Content value="tools" class="pt-2"
					><ToolsTab {tools} /></Tabs.Content
				>
				<Tabs.Content value="events" class="pt-2"
					><EventsTab {events} /></Tabs.Content
				>
				<Tabs.Content value="context" class="pt-2"
					><ContextTab {session} {events} /></Tabs.Content
				>
			</Tabs.Root>
		</Card.Root>
	{/if}
</div>
