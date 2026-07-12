<script lang="ts">
	import type { ObservabilityEvent } from "../../types";
	import {
		dashboard_state,
		duration,
		number_crunch,
		summary,
		time,
	} from "./dashboard-state.svelte";
	import type { TurnGroup } from "./event-analysis";
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

	function tool_names(turn: TurnGroup) {
		return [
			...new Set(
				turn.events
					.filter((event) => event.type.startsWith("tool"))
					.map((event) =>
						String(
							event.payload.toolName ||
								event.payload.tool_name ||
								event.payload.name ||
								"",
						),
					)
					.filter(Boolean),
			),
		].slice(0, 4);
	}

	function event_label(type: string) {
		return type.replaceAll("_", " ");
	}
</script>

<section class="overview-layout">
	<div class="turn-log">
		<div class="section-head overview-head">
			<div>
				<p class="eyebrow">Execution</p>
				<h3>Turn activity</h3>
			</div>
			<div class="filters">
				<select
					bind:value={dashboard_state.selected_type}
					aria-label="Filter event type"
					name="timeline-event-type"
				>
					<option value="">All event types</option>
					{#each known_types as type (type)}<option value={type}>{type}</option
						>{/each}
				</select>
				<input
					bind:value={dashboard_state.event_query}
					aria-label="Search events"
					name="timeline-event-search"
					placeholder="tool:bash status:error…"
				/>
			</div>
		</div>

		<div class="column-labels" aria-hidden="true">
			<span>Sequence / event</span><span>Time</span><span>Observation</span>
		</div>
		<div class="turns">
			{#each turns as turn (turn.id)}
				<details class:error={turn.errors > 0} class="turn" open>
					<summary>
						<div class="turn-identity">
							<i></i>
							<strong>{turn.title}</strong>
							<span>{duration(turn.duration_ms)}</span>
						</div>
						<div class="turn-tools">
							{#each tool_names(turn) as tool (tool)}<code>{tool}</code>{/each}
						</div>
						<div class="turn-counts">
							<span>{number_crunch(turn.events.length)} events</span>
							{#if turn.tools}<span
									>{number_crunch(turn.tools)} tool events</span
								>{/if}
							{#if turn.errors}<span class="error-count"
									>{number_crunch(turn.errors)} errors</span
								>{/if}
						</div>
					</summary>
					<div class="observations">
						{#each turn.events as event (event.event_id)}
							<button
								class:error={event_has_error(event)}
								class="observation"
								onclick={() => (dashboard_state.selected_event = event)}
							>
								<span class="event-key"
									><code>#{number_crunch(event.seq)}</code><strong
										>{event_label(event.type)}</strong
									></span
								>
								<time>{time(event.ts)}</time>
								<p>{summary(event) || "No payload summary"}</p>
							</button>
						{/each}
					</div>
				</details>
			{:else}
				<p class="empty">No turns match the current filters.</p>
			{/each}
		</div>
	</div>

	<aside class="activity-rail" aria-label="Session findings">
		<section class="rail-section attention">
			<div class="rail-head">
				<div>
					<p class="eyebrow">Attention</p>
					<h3>Error events</h3>
				</div>
				<strong
					>{number_crunch(
						visible_events.filter(event_has_error).length,
					)}</strong
				>
			</div>
			{#each visible_events
				.filter(event_has_error)
				.slice(0, 8) as event (event.event_id)}
				<button
					class="finding"
					onclick={() => (dashboard_state.selected_event = event)}
				>
					<span
						><code>#{number_crunch(event.seq)}</code>{event_label(
							event.type,
						)}</span
					>
					<strong>{summary(event)}</strong>
				</button>
			{:else}
				<p class="empty compact">No structured errors in this trace.</p>
			{/each}
		</section>

		<section class="rail-section">
			<div class="rail-head">
				<div>
					<p class="eyebrow">Produced</p>
					<h3>Files & links</h3>
				</div>
				<strong>{number_crunch(artifacts.length)}</strong>
			</div>
			{#each artifacts as artifact (`${artifact.event.event_id}:${artifact.value}`)}
				<button
					class="finding"
					onclick={() => (dashboard_state.selected_event = artifact.event)}
				>
					<span><code>#{number_crunch(artifact.event.seq)}</code>artifact</span>
					<strong title={artifact.value}>{artifact.value}</strong>
				</button>
			{:else}
				<p class="empty compact">No paths or links detected.</p>
			{/each}
		</section>

		<section class="rail-section">
			<div class="rail-head">
				<div>
					<p class="eyebrow">Latest</p>
					<h3>Outputs</h3>
				</div>
				<strong>{number_crunch(final_outputs.length)}</strong>
			</div>
			{#each final_outputs as event (event.event_id)}
				<button
					class="finding"
					onclick={() => (dashboard_state.selected_event = event)}
				>
					<span
						><code>#{number_crunch(event.seq)}</code>{event_label(
							event.type,
						)}</span
					>
					<strong>{summary(event)}</strong>
				</button>
			{:else}
				<p class="empty compact">No final output events loaded.</p>
			{/each}
		</section>
	</aside>
</section>

<style>
	.overview-layout {
		display: grid;
		grid-template-columns: minmax(560px, 1fr) minmax(280px, 0.32fr);
		gap: 18px;
		align-items: start;
	}
	.turn-log,
	.activity-rail {
		min-width: 0;
	}
	.turn-log,
	.rail-section {
		border: 1px solid var(--border-muted);
		background: color-mix(in srgb, var(--surface), transparent 7%);
	}
	.section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		padding: 12px 14px;
		border-bottom: 1px solid var(--border-muted);
	}
	.section-head h3,
	.rail-head h3 {
		font-size: 14px;
	}
	.filters {
		display: grid;
		grid-template-columns: minmax(130px, 0.55fr) minmax(180px, 1fr);
		gap: 7px;
		width: min(480px, 58%);
	}
	.filters input,
	.filters select {
		min-height: 32px;
		padding: 6px 9px;
		border-radius: 5px;
		font-size: var(--font-size-compact);
	}
	.column-labels {
		display: grid;
		grid-template-columns: minmax(210px, 0.42fr) 94px minmax(220px, 1fr);
		gap: 12px;
		padding: 7px 12px;
		border-bottom: 1px solid var(--border-muted);
		color: var(--muted);
		font-size: var(--font-size-label);
		text-transform: uppercase;
		letter-spacing: 0.07em;
	}
	.turn + .turn {
		border-top: 1px solid var(--border-muted);
	}
	.turn.error {
		box-shadow: inset 2px 0 0 var(--red);
	}
	.turn > summary {
		list-style: none;
		cursor: pointer;
		display: grid;
		grid-template-columns: minmax(160px, auto) minmax(100px, 1fr) auto;
		align-items: center;
		gap: 14px;
		min-height: 40px;
		padding: 8px 11px;
		background: color-mix(in srgb, var(--surface-2), transparent 34%);
	}
	.turn > summary::-webkit-details-marker {
		display: none;
	}
	.turn-identity,
	.turn-counts,
	.turn-tools {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.turn-identity i {
		width: 6px;
		height: 6px;
		border-right: 1px solid var(--muted);
		border-bottom: 1px solid var(--muted);
		transform: rotate(45deg) translateY(-2px);
	}
	.turn:not([open]) .turn-identity i {
		transform: rotate(-45deg);
	}
	.turn-identity span,
	.turn-counts,
	.turn-tools code {
		color: var(--muted);
		font-size: var(--font-size-label);
	}
	.turn-tools {
		overflow: hidden;
	}
	.turn-tools code {
		padding: 2px 5px;
		border: 1px solid var(--border-muted);
		white-space: nowrap;
	}
	.turn-counts {
		justify-content: flex-end;
		white-space: nowrap;
	}
	.error-count {
		color: var(--red);
	}
	.observation {
		width: 100%;
		min-height: 37px;
		display: grid;
		grid-template-columns: minmax(210px, 0.42fr) 94px minmax(220px, 1fr);
		gap: 12px;
		align-items: center;
		padding: 7px 12px;
		border: 0;
		border-top: 1px solid
			color-mix(in srgb, var(--border-muted), transparent 48%);
		border-radius: 0;
		background: transparent;
		text-align: left;
	}
	.observation:hover {
		background: color-mix(in srgb, var(--selected), transparent 94%);
		box-shadow: none;
	}
	.observation.error {
		background: color-mix(in srgb, var(--red), transparent 91%);
	}
	.event-key {
		display: flex;
		align-items: center;
		gap: 9px;
		min-width: 0;
	}
	.event-key code {
		color: var(--cyan);
		font-size: var(--font-size-label);
	}
	.event-key strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--font-size-compact);
		font-weight: 600;
		text-transform: capitalize;
	}
	.observation time,
	.observation p {
		color: var(--muted);
		font-size: var(--font-size-compact);
	}
	.observation p {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.activity-rail {
		display: grid;
		gap: 12px;
	}
	.rail-section {
		overflow: hidden;
	}
	.rail-section.attention {
		border-top-color: color-mix(in srgb, var(--red), var(--border-muted) 35%);
	}
	.rail-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 11px 12px;
		border-bottom: 1px solid var(--border-muted);
	}
	.rail-head > strong {
		font: 700 18px/1 var(--font-mono);
	}
	.finding {
		width: 100%;
		min-height: 0;
		display: grid;
		gap: 3px;
		padding: 8px 11px;
		border: 0;
		border-bottom: 1px solid
			color-mix(in srgb, var(--border-muted), transparent 48%);
		border-radius: 0;
		background: transparent;
		text-align: left;
	}
	.finding:hover {
		background: color-mix(in srgb, var(--selected), transparent 94%);
		box-shadow: none;
	}
	.finding span {
		display: flex;
		gap: 7px;
		color: var(--muted);
		font-size: var(--font-size-label);
		text-transform: capitalize;
	}
	.finding code {
		color: var(--cyan);
	}
	.finding strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--font-size-compact);
	}
	@media (max-width: 1200px) {
		.overview-layout {
			grid-template-columns: 1fr;
		}
		.activity-rail {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	@media (max-width: 760px) {
		.section-head {
			align-items: stretch;
			flex-direction: column;
		}
		.filters {
			width: 100%;
		}
		.column-labels {
			display: none;
		}
		.turn > summary {
			grid-template-columns: 1fr auto;
		}
		.turn-tools {
			display: none;
		}
		.turn-counts span:not(.error-count) {
			display: none;
		}
		.observation {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.observation p {
			grid-column: 1 / -1;
		}
		.activity-rail {
			grid-template-columns: 1fr;
		}
	}
</style>
