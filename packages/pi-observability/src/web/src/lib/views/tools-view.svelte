<script lang="ts">
	import { api } from '#lib/api.js';
	import ToolLatencyChart from '#lib/charts/tool-latency-chart.svelte';
	import FailuresList from '#lib/components/failures-list.svelte';
	import StatTile from '#lib/components/stat-tile.svelte';
	import ToolsTable from '#lib/components/tools-table.svelte';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { duration, number_crunch, percent } from '#lib/format.js';
	import { live } from '#lib/live.svelte.js';
	import { range } from '#lib/range.svelte.js';
	import { resource } from '#lib/resource.svelte.js';

	const tools = resource(() => {
		void live.revision;
		return api.tools(range.since());
	});
	const failures = resource(() => {
		void live.revision;
		return api.failures(range.since(), 30);
	});

	const rows = $derived(tools.data?.tools ?? []);
	const calls = $derived(
		rows.reduce((sum, tool) => sum + tool.calls, 0),
	);
	const errors = $derived(
		rows.reduce((sum, tool) => sum + tool.errors, 0),
	);
	const total_ms = $derived(
		rows.reduce((sum, tool) => sum + tool.total_ms, 0),
	);
	const most_errors = $derived(
		rows.toSorted((a, b) => b.errors - a.errors)[0],
	);
</script>

<div
	class={[
		'grid gap-4 transition-opacity',
		tools.loading && tools.data && 'opacity-70',
	]}
>
	{#if tools.error}
		<Alert.Root variant="destructive">
			<Alert.Title>Could not load tool stats</Alert.Title>
			<Alert.Description>{tools.error}</Alert.Description>
		</Alert.Root>
	{/if}

	{#if !tools.data}
		<Skeleton class="h-24 rounded-xl" />
		<Skeleton class="h-96 rounded-xl" />
	{:else}
		<section
			class="grid grid-cols-2 gap-4 lg:grid-cols-4"
			aria-label="Tool totals"
		>
			<StatTile label="Tools used" value={String(rows.length)} />
			<StatTile label="Calls" value={number_crunch(calls)} />
			<StatTile
				label="Errors"
				value={percent(errors, calls)}
				detail={most_errors && most_errors.errors > 0
					? `Most from ${most_errors.name} (${most_errors.errors})`
					: 'No failed calls'}
				tone={errors / Math.max(1, calls) > 0.05
					? 'destructive'
					: 'default'}
			/>
			<StatTile label="Time in tools" value={duration(total_ms)} />
		</section>

		<Card.Root class="pb-0">
			<Card.Header>
				<Card.Title>Recent failures</Card.Title>
				<Card.Description>
					Newest first. Open one to see its full output in the session
					trace.
				</Card.Description>
			</Card.Header>
			<Card.Content class="max-h-112 overflow-auto border-t px-0">
				<FailuresList failures={failures.data?.failures ?? []} />
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>Slowest tools</Card.Title>
				<Card.Description
					>95th percentile duration, top 12</Card.Description
				>
			</Card.Header>
			<Card.Content>
				<ToolLatencyChart tools={rows} limit={12} />
			</Card.Content>
		</Card.Root>

		<Card.Root class="pb-0">
			<Card.Header>
				<Card.Title>All tools</Card.Title>
				<Card.Description>Sorted by total time spent</Card.Description
				>
			</Card.Header>
			<Card.Content class="px-0">
				<ToolsTable tools={rows} />
			</Card.Content>
		</Card.Root>
	{/if}
</div>
