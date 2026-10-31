<script lang="ts">
	import { api } from '#lib/api.js';
	import DailyBars from '#lib/charts/daily-bars.svelte';
	import ToolLatencyChart from '#lib/charts/tool-latency-chart.svelte';
	import SessionsTable from '#lib/components/sessions-table.svelte';
	import StatTile from '#lib/components/stat-tile.svelte';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import {
		duration,
		fill_days,
		money,
		number_crunch,
		percent,
		ratio,
	} from '#lib/format.js';
	import { live } from '#lib/live.svelte.js';
	import { range } from '#lib/range.svelte.js';
	import { resource } from '#lib/resource.svelte.js';
	import { href } from '#lib/router.js';
	import ActivityIcon from '@lucide/svelte/icons/activity';

	const overview = resource(() => {
		void live.revision;
		return api.overview(range.since(), 8);
	});

	const totals = $derived(overview.data?.totals);
	const daily = $derived(
		fill_days(
			overview.data?.daily ?? [],
			overview.data?.since ?? null,
			(day) => ({
				day,
				sessions: 0,
				turns: 0,
				tool_calls: 0,
				tool_errors: 0,
				input_tokens: 0,
				output_tokens: 0,
				cache_read_tokens: 0,
				cache_write_tokens: 0,
				cost_usd: 0,
			}),
		),
	);
	const cache_share = $derived(
		totals
			? percent(
					totals.cache_read_tokens,
					totals.cache_read_tokens + totals.input_tokens,
				)
			: '0%',
	);
</script>

<div
	class={[
		'grid gap-4 transition-opacity',
		overview.loading && overview.data && 'opacity-70',
	]}
>
	{#if overview.error}
		<Alert.Root variant="destructive">
			<Alert.Title>Could not load the overview</Alert.Title>
			<Alert.Description>{overview.error}</Alert.Description>
		</Alert.Root>
	{/if}

	{#if !totals}
		<div class="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
			{#each { length: 6 } as _, index (index)}
				<Skeleton class="h-24 rounded-xl" />
			{/each}
		</div>
		<Skeleton class="h-72 rounded-xl" />
	{:else if totals.sessions === 0}
		<Empty.Root class="min-h-[50vh]">
			<Empty.Header>
				<Empty.Media variant="icon"><ActivityIcon /></Empty.Media>
				<Empty.Title
					>No activity in {range.label.toLowerCase()}</Empty.Title
				>
				<Empty.Description>
					Start a Pi session, or choose a longer time range.
				</Empty.Description>
			</Empty.Header>
		</Empty.Root>
	{:else}
		<section
			class="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6"
			aria-label="Totals"
		>
			<StatTile
				label="Cost"
				value={money(totals.cost_usd)}
				detail="{totals.sessions} sessions"
			/>
			<StatTile
				label="Turns"
				value={number_crunch(totals.turns)}
				detail="{ratio(totals.turns, totals.sessions)} per session"
			/>
			<StatTile
				label="Tool calls"
				value={number_crunch(totals.tool_calls)}
				detail="{ratio(totals.tool_calls, totals.turns)} per turn"
			/>
			<StatTile
				label="Tool errors"
				value={percent(totals.tool_errors, totals.tool_calls)}
				detail="{number_crunch(totals.tool_errors)} failed calls"
				tone={totals.tool_errors / Math.max(1, totals.tool_calls) >
				0.05
					? 'destructive'
					: 'default'}
			/>
			<StatTile
				label="Tokens"
				value={number_crunch(
					totals.input_tokens + totals.output_tokens,
				)}
				detail="{cache_share} of input from cache"
			/>
			<StatTile
				label="Model latency p50"
				value={duration(totals.provider_p50_ms)}
				detail={totals.provider_p95_ms == null
					? 'No timed responses yet'
					: `p95 ${duration(totals.provider_p95_ms)}`}
			/>
		</section>

		<section class="grid gap-4 lg:grid-cols-2">
			<Card.Root>
				<Card.Header>
					<Card.Title>Cost per day</Card.Title>
					<Card.Description
						>Model spend, from Pi's usage accounting</Card.Description
					>
				</Card.Header>
				<Card.Content>
					<DailyBars
						rows={daily.map((row) => ({
							day: row.day,
							value: row.cost_usd,
						}))}
						label="Cost"
						format={money}
					/>
				</Card.Content>
			</Card.Root>
			<Card.Root>
				<Card.Header>
					<Card.Title>Turns per day</Card.Title>
					<Card.Description
						>One turn is one model response and its tool calls</Card.Description
					>
				</Card.Header>
				<Card.Content>
					<DailyBars
						rows={daily.map((row) => ({
							day: row.day,
							value: row.turns,
						}))}
						label="Turns"
						format={(value) => number_crunch(value)}
					/>
				</Card.Content>
			</Card.Root>
		</section>

		<section
			class="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
		>
			<Card.Root>
				<Card.Header>
					<Card.Title>Slowest tools</Card.Title>
					<Card.Description>95th percentile duration</Card.Description
					>
					<Card.Action>
						<Button
							variant="ghost"
							size="sm"
							href={href({ name: 'tools' })}>All tools</Button
						>
					</Card.Action>
				</Card.Header>
				<Card.Content>
					<ToolLatencyChart
						tools={overview.data?.tools ?? []}
						limit={8}
					/>
				</Card.Content>
			</Card.Root>
			<Card.Root>
				<Card.Header>
					<Card.Title>Recent sessions</Card.Title>
					<Card.Description
						>Most recently active in {range.label.toLowerCase()}</Card.Description
					>
					<Card.Action>
						<Button
							variant="ghost"
							size="sm"
							href={href({ name: 'sessions' })}>All sessions</Button
						>
					</Card.Action>
				</Card.Header>
				<Card.Content class="px-0">
					<SessionsTable
						sessions={overview.data?.sessions ?? []}
						show_model={false}
					/>
				</Card.Content>
			</Card.Root>
		</section>
	{/if}
</div>
