<script lang="ts">
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { clock, duration, tool_label } from '#lib/format.js';
	import ArrowDownWideNarrowIcon from '@lucide/svelte/icons/arrow-down-wide-narrow';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import type { ToolSpanRow } from '../../../../../types';

	let { tools }: { tools: ToolSpanRow[] } = $props();

	let order = $state<'time' | 'slowest'>('time');

	const rows = $derived(
		order === 'time'
			? tools
			: tools.toSorted(
					(a, b) => (b.duration_ms ?? 0) - (a.duration_ms ?? 0),
				),
	);
</script>

<div class="flex justify-end gap-1 px-4 pb-2">
	<Button
		variant={order === 'time' ? 'secondary' : 'ghost'}
		size="sm"
		aria-pressed={order === 'time'}
		onclick={() => (order = 'time')}><ClockIcon />In order</Button
	>
	<Button
		variant={order === 'slowest' ? 'secondary' : 'ghost'}
		size="sm"
		aria-pressed={order === 'slowest'}
		onclick={() => (order = 'slowest')}
		><ArrowDownWideNarrowIcon />Slowest first</Button
	>
</div>
<Table.Root>
	<Table.Header>
		<Table.Row>
			<Table.Head>Started</Table.Head>
			<Table.Head>Tool</Table.Head>
			<Table.Head class="text-right">Duration</Table.Head>
			<Table.Head class="hidden text-right sm:table-cell"
				>Updates</Table.Head
			>
			<Table.Head>Result</Table.Head>
		</Table.Row>
	</Table.Header>
	<Table.Body>
		{#each rows as tool (tool.tool_call_id)}
			<Table.Row>
				<Table.Cell class="tabular-nums"
					>{clock(tool.start_ts)}</Table.Cell
				>
				<Table.Cell
					class="max-w-72 truncate font-mono text-xs"
					title={tool.tool_name ?? ''}
					>{tool_label(tool.tool_name ?? 'unknown')}</Table.Cell
				>
				<Table.Cell class="text-right tabular-nums"
					>{duration(tool.duration_ms)}</Table.Cell
				>
				<Table.Cell
					class="hidden text-right text-muted-foreground tabular-nums sm:table-cell"
					>{tool.update_count ?? '—'}</Table.Cell
				>
				<Table.Cell>
					{#if tool.end_ts == null}
						<Badge variant="outline">running</Badge>
					{:else if tool.is_error === 1}
						<Badge variant="destructive">failed</Badge>
					{:else}
						<Badge variant="outline">ok</Badge>
					{/if}
				</Table.Cell>
			</Table.Row>
		{:else}
			<Table.Row>
				<Table.Cell
					colspan={5}
					class="py-8 text-center text-muted-foreground"
				>
					No tool calls in this session.
				</Table.Cell>
			</Table.Row>
		{/each}
	</Table.Body>
</Table.Root>
