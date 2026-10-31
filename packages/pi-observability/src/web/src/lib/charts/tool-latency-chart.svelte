<script lang="ts">
	import { duration, tool_label } from '#lib/format.js';
	import { BarChart, defaultChartPadding } from 'layerchart';
	import type { ToolStats } from '../../../../types';

	let { tools, limit = 10 }: { tools: ToolStats[]; limit?: number } =
		$props();

	// The slowest tools by p95, so one long outlier does not hide the
	// tools that are slow every time.
	const rows = $derived(
		tools
			.toSorted((a, b) => b.p95_ms - a.p95_ms)
			.slice(0, limit)
			.map((tool) => ({
				name: tool_label(tool.name),
				p95: tool.p95_ms,
			})),
	);
</script>

<div style:height="{Math.max(8, rows.length * 2 + 3)}rem">
	<BarChart
		data={rows}
		y="name"
		x="p95"
		orientation="horizontal"
		series={[
			{ key: 'p95', label: 'p95 duration', color: 'var(--chart-1)' },
		]}
		bandPadding={0.45}
		props={{
			bars: { radius: 4, strokeWidth: 0 },
			xAxis: { format: duration, ticks: 4 },
			tooltip: { item: { format: duration } },
		}}
		padding={defaultChartPadding({ left: 200, bottom: 24 })}
	/>
</div>
