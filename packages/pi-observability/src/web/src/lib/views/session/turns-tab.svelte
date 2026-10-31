<script lang="ts">
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import {
		clock,
		duration,
		money,
		number_crunch,
	} from '#lib/format.js';
	import type { TurnSpanRow } from '../../../../../types';

	let { turns }: { turns: TurnSpanRow[] } = $props();
</script>

<Table.Root>
	<Table.Header>
		<Table.Row>
			<Table.Head class="w-12">#</Table.Head>
			<Table.Head>Started</Table.Head>
			<Table.Head class="text-right">Duration</Table.Head>
			<Table.Head class="text-right">Model time</Table.Head>
			<Table.Head class="text-right">Tools</Table.Head>
			<Table.Head class="hidden text-right md:table-cell"
				>Tokens</Table.Head
			>
			<Table.Head class="text-right">Cost</Table.Head>
			<Table.Head>Ended with</Table.Head>
		</Table.Row>
	</Table.Header>
	<Table.Body>
		{#each turns as turn, index (turn.start_seq)}
			<Table.Row>
				<Table.Cell class="text-muted-foreground tabular-nums"
					>{index + 1}</Table.Cell
				>
				<Table.Cell class="tabular-nums"
					>{clock(turn.start_ts)}</Table.Cell
				>
				<Table.Cell class="text-right tabular-nums"
					>{duration(turn.duration_ms)}</Table.Cell
				>
				<Table.Cell class="text-right tabular-nums"
					>{duration(turn.provider_ms)}</Table.Cell
				>
				<Table.Cell class="text-right tabular-nums">
					{#if turn.tool_calls === 0}
						<span class="text-muted-foreground">—</span>
					{:else}
						{turn.tool_calls}
						<span class="text-muted-foreground"
							>· {duration(turn.tool_ms)}</span
						>
						{#if turn.tool_errors > 0}
							<span class="text-destructive"
								>· {turn.tool_errors} failed</span
							>
						{/if}
					{/if}
				</Table.Cell>
				<Table.Cell
					class="hidden text-right tabular-nums md:table-cell"
				>
					{number_crunch(
						(turn.input_tokens ?? 0) + (turn.output_tokens ?? 0),
					)}
				</Table.Cell>
				<Table.Cell class="text-right tabular-nums"
					>{money(turn.cost_usd)}</Table.Cell
				>
				<Table.Cell>
					{#if turn.stop_reason === 'error'}
						<Badge variant="destructive">error</Badge>
					{:else if turn.stop_reason}
						<Badge variant="outline">{turn.stop_reason}</Badge>
					{:else}
						<span class="text-muted-foreground">—</span>
					{/if}
				</Table.Cell>
			</Table.Row>
		{:else}
			<Table.Row>
				<Table.Cell
					colspan={8}
					class="py-8 text-center text-muted-foreground"
				>
					No completed turns yet.
				</Table.Cell>
			</Table.Row>
		{/each}
	</Table.Body>
</Table.Root>
