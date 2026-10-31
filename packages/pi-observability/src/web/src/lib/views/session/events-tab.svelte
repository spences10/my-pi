<script lang="ts">
	import type { DashboardEvent } from '#lib/api.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import {
		event_has_error,
		event_summary,
		query_matches,
		type_label,
	} from '#lib/events.js';
	import { clock } from '#lib/format.js';
	import SearchIcon from '@lucide/svelte/icons/search';
	import EventSheet from './event-sheet.svelte';

	const ALL = '__all__';

	let { events }: { events: DashboardEvent[] } = $props();

	let query = $state('');
	let type = $state(ALL);
	let selected_id = $state<string | null>(null);
	let sheet_open = $state(false);

	const types = $derived(
		[...new Set(events.map((event) => event.type))].sort(),
	);
	const visible = $derived(
		events.filter(
			(event) =>
				(type === ALL || event.type === type) &&
				query_matches(event, query),
		),
	);
	// Look the event up by id so live reloads keep the open drawer current.
	const selected = $derived(
		events.find((event) => event.event_id === selected_id) ?? null,
	);

	function open_event(event: DashboardEvent): void {
		selected_id = event.event_id;
		sheet_open = true;
	}
</script>

<div class="flex flex-wrap items-center gap-2 px-4 pb-2">
	<div class="relative w-full max-w-sm">
		<SearchIcon
			class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
		/>
		<Input
			bind:value={query}
			placeholder="Search, or tool:bash type:tool json:isError=true"
			aria-label="Search events"
			class="pl-8"
		/>
	</div>
	<Select.Root type="single" bind:value={type}>
		<Select.Trigger class="w-52" aria-label="Event type">
			{type === ALL ? 'All event types' : type_label(type)}
		</Select.Trigger>
		<Select.Content>
			<Select.Item value={ALL} label="All event types" />
			{#each types as name (name)}
				<Select.Item value={name} label={type_label(name)} />
			{/each}
		</Select.Content>
	</Select.Root>
	<p class="ml-auto text-sm text-muted-foreground">
		{visible.length} of {events.length} events
	</p>
</div>

<Table.Root>
	<Table.Header>
		<Table.Row>
			<Table.Head class="w-14">#</Table.Head>
			<Table.Head class="w-24">Time</Table.Head>
			<Table.Head class="w-48">Event</Table.Head>
			<Table.Head>Details</Table.Head>
		</Table.Row>
	</Table.Header>
	<Table.Body>
		{#each visible as event (event.event_id)}
			<Table.Row
				class="cursor-pointer"
				data-state={selected_id === event.event_id && sheet_open
					? 'selected'
					: undefined}
				onclick={() => open_event(event)}
			>
				<Table.Cell class="text-muted-foreground tabular-nums"
					>{event.seq}</Table.Cell
				>
				<Table.Cell class="tabular-nums">{clock(event.ts)}</Table.Cell
				>
				<Table.Cell>
					<button
						type="button"
						class="text-left font-medium hover:underline"
						onclick={(click) => {
							click.stopPropagation();
							open_event(event);
						}}
					>
						{type_label(event.type)}
					</button>
					{#if event_has_error(event)}
						<span class="ml-1 text-xs font-medium text-destructive"
							>error</span
						>
					{/if}
				</Table.Cell>
				<Table.Cell
					class="max-w-0 truncate font-mono text-xs text-muted-foreground"
					>{event_summary(event)}</Table.Cell
				>
			</Table.Row>
		{:else}
			<Table.Row>
				<Table.Cell
					colspan={4}
					class="py-8 text-center text-muted-foreground"
				>
					No events match.
				</Table.Cell>
			</Table.Row>
		{/each}
	</Table.Body>
</Table.Root>

<EventSheet event={selected} bind:open={sheet_open} />
