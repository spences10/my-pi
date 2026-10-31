<script lang="ts">
	import * as Table from '#lib/components/ui/table/index.js';
	import {
		duration,
		number_crunch,
		percent,
		tool_label,
	} from '#lib/format.js';
	import type { ToolStats } from '../../../../types';

	let { tools }: { tools: ToolStats[] } = $props();
</script>

<Table.Root>
	<Table.Header>
		<Table.Row>
			<Table.Head>Tool</Table.Head>
			<Table.Head class="text-right">Calls</Table.Head>
			<Table.Head class="text-right">Errors</Table.Head>
			<Table.Head class="text-right">p50</Table.Head>
			<Table.Head class="text-right">p95</Table.Head>
			<Table.Head class="hidden text-right md:table-cell"
				>Max</Table.Head
			>
			<Table.Head class="text-right">Total time</Table.Head>
		</Table.Row>
	</Table.Header>
	<Table.Body>
		{#each tools as tool (tool.name)}
			<Table.Row>
				<Table.Cell
					class="max-w-80 truncate font-mono text-xs"
					title={tool.name}>{tool_label(tool.name)}</Table.Cell
				>
				<Table.Cell class="text-right tabular-nums"
					>{number_crunch(tool.calls)}</Table.Cell
				>
				<Table.Cell
					class={[
						'text-right tabular-nums',
						tool.errors > 0
							? 'text-destructive'
							: 'text-muted-foreground',
					]}
				>
					{tool.errors > 0
						? `${tool.errors} · ${percent(tool.errors, tool.calls)}`
						: '0'}
				</Table.Cell>
				<Table.Cell class="text-right tabular-nums"
					>{duration(tool.p50_ms)}</Table.Cell
				>
				<Table.Cell class="text-right tabular-nums"
					>{duration(tool.p95_ms)}</Table.Cell
				>
				<Table.Cell
					class="hidden text-right tabular-nums md:table-cell"
					>{duration(tool.max_ms)}</Table.Cell
				>
				<Table.Cell class="text-right tabular-nums"
					>{duration(tool.total_ms)}</Table.Cell
				>
			</Table.Row>
		{:else}
			<Table.Row>
				<Table.Cell
					colspan={7}
					class="py-8 text-center text-muted-foreground"
				>
					No tool calls in this range.
				</Table.Cell>
			</Table.Row>
		{/each}
	</Table.Body>
</Table.Root>
