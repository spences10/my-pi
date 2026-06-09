<script lang="ts">
	import type { DashboardSession, ObservabilityEvent } from "../../types";
	import {
		event_cache,
		label,
		query_matches,
		state,
		summary,
		time,
	} from "./dashboard-state.svelte";

	type Event = ObservabilityEvent<Record<string, unknown>>;
	let { sessions }: { sessions: DashboardSession[] } = $props();
</script>

<section class="swimlane panel">
	{#each sessions as session (session.session_id)}<div class="lane">
			<h3>{label(session)}</h3>
			<p>
				{session.pool || "default"} · {(
					event_cache.get(session.session_id) || []
				).length} loaded
			</p>
			{#each (event_cache.get(session.session_id) || [])
				.filter((event: Event) => query_matches(event, state.event_query))
				.slice(0, 60) as event (event.event_id)}<button
					class="lane-event"
					onclick={() => (state.selected_event = event)}
					><strong>{event.type}</strong><span>{time(event.ts)}</span><small
						>{summary(event)}</small
					></button
				>{/each}
		</div>{/each}
</section>

<style>
	.swimlane {
		display: grid;
		grid-template-columns: repeat(4, minmax(240px, 1fr));
		gap: 1px;
		overflow: auto;
	}
	.lane {
		min-width: 240px;
		padding: 14px;
		border-right: 1px solid var(--border-muted);
	}
	.lane p {
		color: var(--muted);
		font-size: 12px;
		margin: 4px 0 12px;
	}
	.lane-event {
		display: grid;
		gap: 4px;
		width: 100%;
		text-align: left;
		margin-bottom: 8px;
	}
	.lane-event span,
	.lane-event small {
		color: var(--muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	@media (max-width: 1200px) {
		.swimlane {
			grid-template-columns: repeat(2, minmax(240px, 1fr));
		}
	}
	@media (max-width: 720px) {
		.swimlane {
			grid-template-columns: 1fr;
		}
	}
</style>
