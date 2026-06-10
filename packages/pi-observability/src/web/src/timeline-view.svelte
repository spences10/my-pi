<script lang="ts">
	import type { ObservabilityEvent } from "../../types";
	import type { TurnGroup } from "./event-analysis";
	import {
		duration,
		number_crunch,
		state,
		summary,
		time,
	} from "./dashboard-state.svelte";
	import { event_has_error } from "./event-analysis";

	type Event = ObservabilityEvent<Record<string, unknown>>;
	type Artifact = { event: Event; value: string };

	let {
		artifacts,
		final_outputs,
		known_types,
		turns,
		visible_events,
	}: {
		artifacts: Artifact[];
		final_outputs: Event[];
		known_types: string[];
		turns: TurnGroup[];
		visible_events: Event[];
	} = $props();
</script>

<section class="timeline-layout">
	<div class="panel timeline-panel">
		<div class="panel-head">
			<div>
				<h3>Turn timeline</h3>
				<span>Session → turn traces → observations</span>
			</div>
			<div class="filters">
				<select bind:value={state.selected_type}
					><option value="">All types</option
					>{#each known_types as type (type)}<option value={type}>{type}</option
						>{/each}</select
				><input
					bind:value={state.event_query}
					placeholder="type:, tool:, status:, json:path=value…"
				/>
			</div>
		</div>
		<div class="turns">
			{#each turns as turn (turn.id)}
				<article class:error={turn.errors} class="turn-card">
					<header class="turn-head">
						<div>
							<strong>{turn.title}</strong>
							<span
								>{number_crunch(turn.events.length)} observations · {duration(
									turn.duration_ms,
								)}</span
							>
						</div>
						<div class="turn-metrics">
							<span>{number_crunch(turn.providers)} provider</span>
							<span>{number_crunch(turn.tools)} tool</span>
							<span class:error={turn.errors}
								>{number_crunch(turn.errors)} errors</span
							>
						</div>
					</header>
					<div class="observations">
						{#each turn.events as event (event.event_id)}
							<button
								class:error={event_has_error(event)}
								class="observation"
								onclick={() => (state.selected_event = event)}
							>
								<span class="pill">#{number_crunch(event.seq)}</span>
								<strong>{event.type}</strong>
								<small>{time(event.ts)}</small>
								<p>{summary(event)}</p>
							</button>
						{/each}
					</div>
				</article>
			{:else}<p class="empty">No matching turns.</p>{/each}
		</div>
	</div>
	<div class="insight-stack">
		<div class="panel">
			<div class="panel-head">
				<h3>Error focus</h3>
				<span>{number_crunch(state.trace?.metrics.errors ?? 0)}</span>
			</div>
			{#each visible_events
				.filter(event_has_error)
				.slice(0, 8) as event (event.event_id)}<button
					class="compact-row artifact"
					onclick={() => (state.selected_event = event)}
					><strong>{summary(event)}</strong><span
						>#{number_crunch(event.seq)}</span
					></button
				>{:else}<p class="empty compact">No error observations.</p>{/each}
		</div>
		<div class="panel">
			<div class="panel-head">
				<h3>Artifacts and links</h3>
				<span>{number_crunch(artifacts.length)}</span>
			</div>
			{#each artifacts as artifact (`${artifact.event.event_id}:${artifact.value}`)}<button
					class="compact-row artifact"
					onclick={() => (state.selected_event = artifact.event)}
					><strong title={artifact.value}>{artifact.value}</strong><span
						>#{number_crunch(artifact.event.seq)}</span
					></button
				>{:else}<p class="empty compact">No obvious paths or links.</p>{/each}
		</div>
		<div class="panel">
			<div class="panel-head">
				<h3>Final outputs</h3>
				<span>{number_crunch(final_outputs.length)}</span>
			</div>
			{#each final_outputs as event (event.event_id)}<button
					class="compact-row artifact"
					onclick={() => (state.selected_event = event)}
					><strong>{summary(event)}</strong><span>{event.type}</span></button
				>{:else}<p class="empty compact">No final output events.</p>{/each}
		</div>
	</div>
</section>

<style>
	.timeline-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(300px, 0.36fr);
		gap: 18px;
		align-items: start;
	}
	.timeline-panel,
	.insight-stack .panel {
		min-width: 0;
		overflow: hidden;
	}
	.turns,
	.insight-stack {
		display: grid;
		gap: 14px;
	}
	.turns {
		gap: 12px;
		padding: 14px;
	}
	.turn-card {
		border: 1px solid var(--border-muted);
		border-radius: 16px;
		overflow: hidden;
		background: color-mix(in srgb, var(--surface-2), transparent 28%);
	}
	.turn-card.error {
		border-color: color-mix(in srgb, var(--red), var(--border-muted) 45%);
	}
	.turn-head {
		height: auto;
		position: static;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		padding: 14px 16px;
		border: 0;
		border-bottom: 1px solid var(--border-muted);
		background: color-mix(in srgb, var(--surface), transparent 18%);
		backdrop-filter: none;
	}
	.turn-head div:first-child {
		display: grid;
		gap: 4px;
	}
	.turn-head span,
	.turn-metrics span {
		color: var(--muted);
		font-size: 12px;
	}
	.turn-metrics {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		justify-content: flex-end;
	}
	.turn-metrics span {
		border: 1px solid var(--border-muted);
		border-radius: 999px;
		padding: 4px 8px;
	}
	.turn-metrics span.error {
		border-color: var(--red);
		color: var(--red);
	}
	.observations {
		display: grid;
	}
	.observation {
		width: 100%;
		display: grid;
		grid-template-columns: auto minmax(140px, 0.35fr) auto minmax(220px, 1fr);
		gap: 9px;
		align-items: center;
		text-align: left;
		border-width: 0 0 1px;
		border-radius: 0;
		background: transparent;
	}
	.observation:last-child {
		border-bottom: 0;
	}
	.observation.error {
		background: color-mix(in srgb, var(--red), transparent 86%);
	}
	.observation p {
		color: color-mix(in srgb, var(--text), var(--muted) 45%);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.observation small {
		color: var(--muted);
		white-space: nowrap;
	}
	@media (max-width: 1200px) {
		.timeline-layout {
			display: block;
		}
		.observation {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 720px) {
		.turn-head {
			align-items: stretch;
			flex-direction: column;
		}
	}
</style>
