<script lang="ts">
	import { day_label } from '#lib/format.js';
	import { BarChart, defaultChartPadding } from 'layerchart';

	type Row = { day: string; value: number };

	let {
		rows,
		label,
		format,
		color = 'var(--chart-1)',
	}: {
		rows: Row[];
		label: string;
		format: (value: number) => string;
		color?: string;
	} = $props();

	// One bar per day. The axis shows the month only on the first bar
	// and on the 1st, so labels fit on narrow screens; the tooltip
	// header always shows the full date.
	const data = $derived(
		rows.map((row, index) => ({
			...row,
			label:
				index === 0 || row.day.endsWith('-01')
					? day_label(row.day)
					: String(Number(row.day.slice(8))),
		})),
	);
	const full_labels = $derived(
		new Map(data.map((row) => [row.label, day_label(row.day)])),
	);
</script>

<div class="h-56">
	<BarChart
		{data}
		x="label"
		y="value"
		series={[{ key: 'value', label, color }]}
		bandPadding={data.length > 10 ? 0.35 : 0.55}
		props={{
			bars: { radius: 4, strokeWidth: 0 },
			yAxis: { format, ticks: 4 },
			tooltip: {
				header: {
					format: (value: string) => full_labels.get(value) ?? value,
				},
				item: { format },
			},
		}}
		padding={defaultChartPadding({ left: 48, bottom: 24 })}
	/>
</div>
