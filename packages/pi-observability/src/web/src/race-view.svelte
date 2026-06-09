<script lang="ts">
	import type { DashboardSession, ObservabilityEvent } from "../../types";
	import { label, state, summary, time } from "./dashboard-state.svelte";

	type Event = ObservabilityEvent<Record<string, unknown>>;
	let { rows }: { rows: { session: DashboardSession; event: Event }[] } =
		$props();
</script>

<section class="race panel">
	<table>
		<thead
			><tr
				><th>Time</th><th>Session</th><th>Seq</th><th>Event</th><th>Summary</th
				></tr
			></thead
		><tbody
			>{#each rows.slice(0, 400) as row (`${row.session.session_id}:${row.event.event_id}`)}<tr
					onclick={() => (state.selected_event = row.event)}
					><td>{time(row.event.ts)}</td><td>{label(row.session)}</td><td
						>#{row.event.seq}</td
					><td>{row.event.type}</td><td>{summary(row.event)}</td></tr
				>{/each}</tbody
		>
	</table>
</section>

<style>
	.race {
		overflow: auto;
	}
	.race table {
		width: 100%;
		border-collapse: collapse;
	}
	.race th,
	.race td {
		border-bottom: 1px solid var(--border-muted);
		padding: 10px;
		text-align: left;
		white-space: nowrap;
	}
	.race td:last-child {
		white-space: normal;
	}
	.race tr {
		cursor: pointer;
	}
	.race tr:hover {
		background: color-mix(in srgb, var(--focus), transparent 88%);
	}
</style>
