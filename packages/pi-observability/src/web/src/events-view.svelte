<script lang="ts">
	import type { ObservabilityEvent } from "../../types";
	import {
		dashboard_state,
		number_crunch,
		summary,
		time,
	} from "./dashboard-state.svelte";
	import { event_has_error } from "./event-analysis";

	type Event = ObservabilityEvent<Record<string, unknown>>;

	let {
		known_types,
		visible_events,
	}: { known_types: string[]; visible_events: Event[] } = $props();
</script>

<section class="panel events-panel">
	<div class="panel-head">
		<h3>Event stream</h3>
		<div class="filters">
			<select bind:value={dashboard_state.selected_type}
				><option value="">All types</option
				>{#each known_types as type (type)}<option value={type}>{type}</option
					>{/each}</select
			><input
				bind:value={dashboard_state.event_query}
				placeholder="type:, tool:, status:, json:path=value…"
			/>
		</div>
	</div>
	<div class="events full">
		{#each visible_events.slice(0, 400) as event (event.event_id)}<button
				class:error={event_has_error(event)}
				class="event"
				onclick={() => (dashboard_state.selected_event = event)}
				><span class="pill">#{number_crunch(event.seq)}</span><strong
					>{event.type}</strong
				><small>{time(event.ts)}</small>
				<p>{summary(event)}</p></button
			>{/each}
	</div>
</section>

<style>
	.events-panel {
		overflow: hidden;
	}
	.events {
		max-height: calc(100vh - 370px);
		overflow: auto;
	}
	.event {
		width: 100%;
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 8px;
		text-align: left;
		border-width: 0 0 1px;
		border-radius: 0;
		background: transparent;
	}
	.event.error {
		background: color-mix(in srgb, var(--red), transparent 86%);
	}
	.event p {
		grid-column: 1/-1;
		color: color-mix(in srgb, var(--text), var(--muted) 45%);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.event small {
		color: var(--muted);
	}
	@media (max-width: 1200px) {
		.events {
			max-height: none;
		}
	}
</style>
