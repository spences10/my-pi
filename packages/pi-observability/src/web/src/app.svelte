<script lang="ts">
	import { onMount } from "svelte";
	import type { DashboardSession, ObservabilityEvent } from "../../types";
	import EventDrawer from "./event-drawer.svelte";
	import HeaderBar from "./header-bar.svelte";
	import SessionLabels from "./session-labels.svelte";
	import Sidebar from "./sidebar.svelte";
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
		summary,
		time,
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
						<p class="eyebrow">Selected trace</p>
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
						class:active={state.selected_view === "trace"}
						onclick={() => (state.selected_view = "trace")}>Trace</button
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

				{#if state.selected_view === "trace"}
					<section class="insight-grid trace-layout">
						<div class="trace-main">
							<div class="panel span-panel">
								<div class="panel-head">
									<h3>Waterfall bottlenecks</h3>
									<span>{state.trace.spans.length} spans</span>
								</div>
								{#each state.trace.spans as span (span.id)}<div
										class:error={span.error}
										class="span-row"
									>
										<div class="span-label">
											<strong>{span.name}</strong><span
												>{span.kind} · {span.event_count} events</span
											>
										</div>
										<div class="bar">
											<i
												style:width={`${Math.max(4, (span.duration_ms / max_span) * 100)}%`}
											></i>
										</div>
										<time>{duration(span.duration_ms)}</time>
									</div>{/each}
							</div>
						</div>
						<div class="insight-stack">
							<div class="panel">
								<div class="panel-head">
									<h3>Tool duration</h3>
									<span>{tool_spans.length}</span>
								</div>
								{#each tool_spans as span (span.id)}<div class="compact-row">
										<strong>{span.name}</strong><span
											>{duration(span.duration_ms)}</span
										>
									</div>{:else}<p class="empty compact">
										No tool spans.
									</p>{/each}
							</div>
							<div class="panel">
								<div class="panel-head">
									<h3>Provider calls</h3>
									<span>{provider_spans.length}</span>
								</div>
								{#each provider_spans as span (span.id)}<div
										class="compact-row"
									>
										<strong>{span.name}</strong><span
											>{duration(span.duration_ms)}</span
										>
									</div>{:else}<p class="empty compact">
										No provider spans.
									</p>{/each}
							</div>
							<div class="panel">
								<div class="panel-head">
									<h3>Artifacts and links</h3>
									<span>{artifacts.length}</span>
								</div>
								{#each artifacts as artifact (`${artifact.event.event_id}:${artifact.value}`)}<button
										class="compact-row artifact"
										onclick={() => (state.selected_event = artifact.event)}
										><strong title={artifact.value}>{artifact.value}</strong
										><span>#{artifact.event.seq}</span></button
									>{:else}<p class="empty compact">
										No obvious paths or links.
									</p>{/each}
							</div>
							<div class="panel">
								<div class="panel-head">
									<h3>Final outputs</h3>
									<span>{final_outputs.length}</span>
								</div>
								{#each final_outputs as event (event.event_id)}<button
										class="compact-row artifact"
										onclick={() => (state.selected_event = event)}
										><strong>{summary(event)}</strong><span>{event.type}</span
										></button
									>{:else}<p class="empty compact">
										No final output events.
									</p>{/each}
							</div>
						</div>
						<div class="panel events-panel trace-events">
							<div class="panel-head">
								<h3>Event stream</h3>
								<div class="filters">
									<select bind:value={state.selected_type}
										><option value="">All types</option
										>{#each known_types as type (type)}<option value={type}
												>{type}</option
											>{/each}</select
									><input
										bind:value={state.event_query}
										placeholder="type:, tool:, status:, json:path=value…"
									/>
								</div>
							</div>
							<div class="events">
								{#each visible_events.slice(0, 180) as event (event.event_id)}<button
										class="event"
										onclick={() => (state.selected_event = event)}
										><span class="pill">#{event.seq}</span><strong
											>{event.type}</strong
										><small>{time(event.ts)}</small>
										<p>{summary(event)}</p></button
									>{/each}
							</div>
						</div>
					</section>
				{:else if state.selected_view === "swimlane"}
					<section class="swimlane panel">
						{#each comparison_sessions as session (session.session_id)}<div
								class="lane"
							>
								<h3>{label(session)}</h3>
								<p>
									{session.pool || "default"} · {(
										event_cache.get(session.session_id) || []
									).length} loaded
								</p>
								{#each (event_cache.get(session.session_id) || [])
									.filter((event) => query_matches(event, state.event_query))
									.slice(0, 60) as event (event.event_id)}<button
										class="lane-event"
										onclick={() => (state.selected_event = event)}
										><strong>{event.type}</strong><span>{time(event.ts)}</span
										><small>{summary(event)}</small></button
									>{/each}
							</div>{/each}
					</section>
				{:else}
					<section class="race panel">
						<table>
							<thead
								><tr
									><th>Time</th><th>Session</th><th>Seq</th><th>Event</th><th
										>Summary</th
									></tr
								></thead
							><tbody
								>{#each race_rows.slice(0, 400) as row (`${row.session.session_id}:${row.event.event_id}`)}<tr
										onclick={() => (state.selected_event = row.event)}
										><td>{time(row.event.ts)}</td><td>{label(row.session)}</td
										><td>#{row.event.seq}</td><td>{row.event.type}</td><td
											>{summary(row.event)}</td
										></tr
									>{/each}</tbody
							>
						</table>
					</section>
				{/if}
			{:else}<div class="panel empty">
					Select a session to inspect trace bottlenecks.
				</div>{/if}
		</section>

		<EventDrawer />
	</main>
</div>
