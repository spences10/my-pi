<script lang="ts">
	import { duration } from '#lib/format.js';
	import { BarChart, defaultChartPadding } from 'layerchart';
	import type { TurnSpanRow } from '../../../../types';

	let { turns }: { turns: TurnSpanRow[] } = $props();

	// Each turn splits into model time, tool time, and the rest
	// (queueing, hooks, extension work).
	const rows = $derived(
		turns.map((turn, index) => {
			const provider = turn.provider_ms ?? 0;
			const tool = turn.tool_ms ?? 0;
			return {
				turn: String(index + 1),
				provider,
				tool,
				other: Math.max(0, turn.duration_ms - provider - tool),
			};
		}),
	);
</script>

<div class="h-64">
	<BarChart
		data={rows}
		x="turn"
		seriesLayout="stack"
		series={[
			{ key: 'provider', label: 'Model', color: 'var(--chart-1)' },
			{ key: 'tool', label: 'Tools', color: 'var(--chart-2)' },
			{
				key: 'other',
				label: 'Other',
				color:
					'color-mix(in oklch, var(--muted-foreground) 45%, transparent)',
			},
		]}
		bandPadding={rows.length > 40
			? 0.2
			: rows.length > 15
				? 0.35
				: 0.55}
		legend
		props={{
			bars: { radius: 2, strokeWidth: 0 },
			yAxis: { format: duration, ticks: 4 },
			tooltip: {
				header: { format: (value: string) => `Turn ${value}` },
				item: { format: duration },
				hideTotal: true,
			},
		}}
		padding={defaultChartPadding({ left: 52, bottom: 48 })}
	/>
</div>
