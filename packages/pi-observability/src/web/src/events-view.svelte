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

	function event_label(type: string) {
		return type.replaceAll("_", " ");
	}

	function event_source(event: Event) {
		return (
			event.payload.toolName ||
			event.payload.tool_name ||
			event.model ||
			event.provider ||
			"—"
		);
	}
</script>

<section class="events-panel">
	<div class="events-head">
		<div>
			<p class="eyebrow">Lifecycle log</p>
			<h3>Events</h3>
		</div>
		<div class="result-count">
			<strong>{number_crunch(visible_events.length)}</strong><span
				>matching / first 400 shown</span
			>
		</div>
		<div class="filters">
			<select
				bind:value={dashboard_state.selected_type}
				aria-label="Filter event type"
				name="event-type"
			>
				<option value="">All event types</option>
				{#each known_types as type (type)}<option value={type}>{type}</option
					>{/each}
			</select>
			<input
				bind:value={dashboard_state.event_query}
				aria-label="Search event payloads"
				name="event-search"
				placeholder="type:, tool:, status:, json:path=value…"
			/>
		</div>
	</div>
	<div class="event-columns" aria-hidden="true">
		<span>Seq</span><span>Event</span><span>Source</span><span>Time</span><span
			>Payload summary</span
		>
	</div>
	<div class="events">
		{#each visible_events.slice(0, 400) as event (event.event_id)}
			<button
				class:error={event_has_error(event)}
				class="event"
				onclick={() => (dashboard_state.selected_event = event)}
			>
				<code>#{number_crunch(event.seq)}</code>
				<strong>{event_label(event.type)}</strong>
				<span class="source">{event_source(event)}</span>
				<time>{time(event.ts)}</time>
				<p>{summary(event) || "No payload summary"}</p>
			</button>
		{:else}
			<p class="empty">No events match the current filters.</p>
		{/each}
	</div>
</section>

<style>
	.events-panel {
		overflow: hidden;
		border: 1px solid var(--border-muted);
		background: color-mix(in srgb, var(--surface), transparent 7%);
	}
	.events-head {
		display: grid;
		grid-template-columns: auto auto minmax(360px, 1fr);
		align-items: center;
		gap: 22px;
		padding: 11px 13px;
		border-bottom: 1px solid var(--border-muted);
	}
	.events-head h3 {
		font-size: 14px;
	}
	.result-count {
		display: grid;
		grid-template-columns: auto auto;
		align-items: baseline;
		gap: 7px;
	}
	.result-count strong {
		font: 700 18px/1 var(--font-mono);
	}
	.result-count span {
		color: var(--muted);
		font-size: var(--font-size-label);
	}
	.filters {
		display: grid;
		grid-template-columns: minmax(150px, 0.42fr) minmax(220px, 1fr);
		gap: 7px;
	}
	.filters input,
	.filters select {
		min-height: 32px;
		padding: 6px 9px;
		border-radius: 5px;
		font-size: var(--font-size-compact);
	}
	.event-columns,
	.event {
		display: grid;
		grid-template-columns: 56px minmax(140px, 0.45fr) minmax(
				100px,
				0.32fr
			) 92px minmax(220px, 1fr);
		gap: 12px;
		align-items: center;
	}
	.event-columns {
		padding: 7px 11px;
		border-bottom: 1px solid var(--border-muted);
		color: var(--muted);
		font-size: var(--font-size-label);
		text-transform: uppercase;
		letter-spacing: 0.07em;
	}
	.events {
		max-height: calc(100vh - 374px);
		overflow: auto;
	}
	.event {
		width: 100%;
		min-height: 38px;
		padding: 7px 11px;
		border: 0;
		border-bottom: 1px solid
			color-mix(in srgb, var(--border-muted), transparent 48%);
		border-radius: 0;
		background: transparent;
		text-align: left;
	}
	.event:hover {
		background: color-mix(in srgb, var(--selected), transparent 94%);
		box-shadow: none;
	}
	.event.error {
		background: color-mix(in srgb, var(--red), transparent 91%);
		box-shadow: inset 2px 0 0 var(--red);
	}
	.event code {
		color: var(--cyan);
		font-size: var(--font-size-label);
	}
	.event strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--font-size-compact);
		text-transform: capitalize;
	}
	.event .source,
	.event time,
	.event p {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--muted);
		font-size: var(--font-size-compact);
	}
	.event .source {
		color: color-mix(in srgb, var(--cyan), var(--muted) 48%);
		font-family: var(--font-mono);
	}
	@media (max-width: 1100px) {
		.events-head {
			grid-template-columns: auto 1fr;
		}
		.filters {
			grid-column: 1 / -1;
		}
		.events {
			max-height: none;
		}
	}
	@media (max-width: 720px) {
		.events-head {
			grid-template-columns: 1fr;
			gap: 10px;
		}
		.filters {
			grid-column: auto;
			grid-template-columns: 1fr;
		}
		.event-columns {
			display: none;
		}
		.event {
			grid-template-columns: 52px minmax(0, 1fr) auto;
			gap: 5px 10px;
			padding-block: 9px;
		}
		.event .source {
			display: none;
		}
		.event time {
			grid-column: 3;
			grid-row: 1;
		}
		.event p {
			grid-column: 2 / -1;
		}
	}
</style>
