<script lang="ts">
	import { onMount } from "svelte";
	import type { DashboardSession, ObservabilityEvent } from "../../types";
	import { build_turns } from "./event-analysis";
	import EventDrawer from "./event-drawer.svelte";
	import EventsView from "./events-view.svelte";
	import HeaderBar from "./header-bar.svelte";
	import RaceView from "./race-view.svelte";
	import SessionLabels from "./session-labels.svelte";
	import Sidebar from "./sidebar.svelte";
	import SwimlaneView from "./swimlane-view.svelte";
	import TimelineView from "./timeline-view.svelte";
	import WaterfallView from "./waterfall-view.svelte";
	import {
		connect,
		duration,
		event_cache,
		extract_artifacts,
		label,
		load_comparison,
		load_sessions,
		query_matches,
		read_labels,
		read_theme,
		state,
	} from "./dashboard-state.svelte";

	type Event = ObservabilityEvent<Record<string, unknown>>;
	type Session = DashboardSession;
	const visible_sessions = $derived(
		state.sessions.filter((session) =>
			[
				session.session_id,
				session.agent_name,
				session.cwd,
				session.pool,
				session.provider,
				session.model,
				...(session.tags || []),
				...(state.labels[session.session_id] || []),
			]
				.filter(Boolean)
				.join(" ")
				.toLowerCase()
				.includes(state.query.toLowerCase()),
		),
	);
	const known_types = $derived(
		[...new Set(state.events.map((event) => event.type))].sort((a, b) =>
			a.localeCompare(b),
		),
	);
	const visible_events = $derived(
		state.events.filter(
			(event) =>
				(!state.selected_type || event.type === state.selected_type) &&
				query_matches(event, state.event_query),
		),
	);
	const max_span = $derived(
		Math.max(1, ...(state.trace?.spans ?? []).map((span) => span.duration_ms)),
	);
	const grouped_sessions = $derived.by(() => {
		const groups: Record<string, { name: string; sessions: Session[] }> = {};
		for (const session of visible_sessions) {
			const key = session.cwd || "unknown project";
			const name =
				key.replace(/\/+$/, "").split("/").filter(Boolean).pop() || key;
			groups[key] ??= { name, sessions: [] };
			groups[key].sessions.push(session);
		}
		return Object.values(groups).sort((a, b) => a.name.localeCompare(b.name));
	});
	const comparison_sessions = $derived(visible_sessions.slice(0, 8));
	const race_rows = $derived.by(() => {
		const rows: { session: Session; event: Event }[] = [];
		for (const session of comparison_sessions) {
			for (const event of event_cache.get(session.session_id) || []) {
				if (query_matches(event, state.event_query))
					rows.push({ session, event });
			}
		}
		return rows.sort((a, b) => a.event.ts.localeCompare(b.event.ts));
	});
	const tool_spans = $derived(
		(state.trace?.spans ?? [])
			.filter((span) => span.kind === "tool")
			.slice(0, 8),
	);
	const provider_spans = $derived(
		(state.trace?.spans ?? [])
			.filter((span) => span.kind === "provider")
			.slice(0, 8),
	);
	const artifacts = $derived(extract_artifacts(visible_events).slice(0, 10));
	const final_outputs = $derived(
		visible_events
			.filter((event) =>
				["agent_end", "message_end", "session_shutdown"].includes(event.type),
			)
			.slice(0, 6),
	);
	const turns = $derived.by(() => build_turns(visible_events));

	onMount(() => {
		read_theme();
		read_labels();
		void load_sessions();
		return connect();
	});
</script>

<svelte:head><title>Pi Observability</title></svelte:head>

<div class:light={state.theme === "light"} class="app-shell">
	<HeaderBar />

	<main>
		<Sidebar groups={grouped_sessions} />

		<section class="content">
			{#if state.trace}
				<section class="hero panel">
					<div>
						<p class="eyebrow">Selected session</p>
						<h2>
							{state.trace.session
								? label(state.trace.session)
								: state.selected_id}
						</h2>
						<p>{state.trace.session?.cwd}</p>
					</div>
					<div class="metric-grid">
						<div>
							<strong>{state.trace.metrics.events}</strong><span>events</span>
						</div>
						<div>
							<strong>{duration(state.trace.metrics.elapsed_ms)}</strong><span
								>elapsed</span
							>
						</div>
						<div>
							<strong>{duration(state.trace.metrics.blocking_ms)}</strong><span
								>blocking</span
							>
						</div>
						<div>
							<strong>{state.trace.metrics.errors}</strong><span>errors</span>
						</div>
						<div>
							<strong>{state.trace.metrics.total_tokens || "—"}</strong><span
								>tokens</span
							>
						</div>
						<div>
							<strong
								>{state.trace.metrics.cost_usd
									? `$${state.trace.metrics.cost_usd.toFixed(3)}`
									: "—"}</strong
							><span>cost</span>
						</div>
					</div>
				</section>

				<nav class="view-tabs">
					<button
						class:active={state.selected_view === "timeline"}
						onclick={() => (state.selected_view = "timeline")}>Timeline</button
					><button
						class:active={state.selected_view === "waterfall"}
						onclick={() => (state.selected_view = "waterfall")}
						>Waterfall</button
					><button
						class:active={state.selected_view === "events"}
						onclick={() => (state.selected_view = "events")}>Events</button
					><button
						class:active={state.selected_view === "swimlane"}
						onclick={() => {
							state.selected_view = "swimlane";
							void load_comparison(comparison_sessions);
						}}>Swimlane</button
					><button
						class:active={state.selected_view === "race"}
						onclick={() => {
							state.selected_view = "race";
							void load_comparison(comparison_sessions);
						}}>Race</button
					>
				</nav>

				<SessionLabels />

				{#if state.selected_view === "timeline"}
					<TimelineView
						{artifacts}
						{final_outputs}
						{known_types}
						{turns}
						{visible_events}
					/>
				{:else if state.selected_view === "waterfall"}
					<WaterfallView {max_span} {provider_spans} {tool_spans} />
				{:else if state.selected_view === "events"}
					<EventsView {known_types} {visible_events} />
				{:else if state.selected_view === "swimlane"}
					<SwimlaneView sessions={comparison_sessions} />
				{:else}
					<RaceView rows={race_rows} />
				{/if}
			{:else}<div class="panel empty">
					Select a session to inspect timeline, waterfall, and event details.
				</div>{/if}
		</section>

		<EventDrawer />
	</main>
</div>

<style>
	.hero {
		display: flex;
		justify-content: space-between;
		gap: 20px;
		padding: 22px;
		margin-bottom: 14px;
	}
	.hero p {
		color: var(--muted);
	}
	.metric-grid {
		display: grid;
		grid-template-columns: repeat(6, minmax(90px, 1fr));
		gap: 10px;
	}
	.metric-grid div {
		background: var(--bg);
		border: 1px solid var(--border-muted);
		border-radius: 14px;
		padding: 12px;
	}
	.metric-grid strong {
		display: block;
		font-size: 22px;
	}
	.metric-grid span {
		color: var(--muted);
		font-size: 12px;
	}
	.view-tabs {
		display: flex;
		gap: 10px;
		margin: 0 0 14px;
	}
	@media (max-width: 1200px) {
		.hero {
			display: block;
		}
		.metric-grid {
			grid-template-columns: repeat(2, 1fr);
			margin-top: 16px;
		}
	}
	@media (max-width: 720px) {
		.metric-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
