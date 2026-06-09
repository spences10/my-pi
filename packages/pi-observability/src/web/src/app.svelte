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
	type TurnGroup = {
		id: string;
		title: string;
		start?: Event;
		end?: Event;
		events: Event[];
		duration_ms: number;
		errors: number;
		tools: number;
		providers: number;
	};

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

	function has_error_value(value: unknown): boolean {
		if (!value || typeof value !== "object") return false;
		const record = value as Record<string, unknown>;
		if (
			Boolean(record.error) ||
			record.isError === true ||
			String(record.status || "").toLowerCase() === "error"
		)
			return true;
		return Object.values(record).some(has_error_value);
	}

	function event_has_error(event: Event) {
		return event.type === "error" || has_error_value(event.payload);
	}

	function elapsed(start?: Event, end?: Event) {
		if (!start || !end) return 0;
		return Math.max(
			0,
			new Date(end.ts).valueOf() - new Date(start.ts).valueOf(),
		);
	}

	function build_turns(events: Event[]): TurnGroup[] {
		const ordered = [...events].sort((a, b) => a.seq - b.seq);
		const groups: TurnGroup[] = [];
		let current: TurnGroup | null = null;
		for (const event of ordered) {
			if (event.type === "turn_start") {
				current = {
					id: event.event_id,
					title: `Turn ${groups.length + 1}`,
					start: event,
					events: [event],
					duration_ms: 0,
					errors: 0,
					tools: 0,
					providers: 0,
				};
				groups.push(current);
				continue;
			}
			if (!current) {
				current = {
					id: `setup:${event.event_id}`,
					title: "Session setup",
					events: [],
					duration_ms: 0,
					errors: 0,
					tools: 0,
					providers: 0,
				};
				groups.push(current);
			}
			current.events.push(event);
			if (event.type === "turn_end") {
				current.end = event;
				current = null;
			}
		}
		for (const group of groups) {
			group.duration_ms = elapsed(
				group.start || group.events[0],
				group.end || group.events[group.events.length - 1],
			);
			group.errors = group.events.filter(event_has_error).length;
			group.tools = group.events.filter((event) =>
				event.type.startsWith("tool"),
			).length;
			group.providers = group.events.filter((event) =>
				event.type.startsWith("provider"),
			).length;
		}
		return groups.reverse();
	}

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
										>{#each known_types as type (type)}<option value={type}
												>{type}</option
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
													>{turn.events.length} observations · {duration(
														turn.duration_ms,
													)}</span
												>
											</div>
											<div class="turn-metrics">
												<span>{turn.providers} provider</span>
												<span>{turn.tools} tool</span>
												<span class:error={turn.errors}
													>{turn.errors} errors</span
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
													<span class="pill">#{event.seq}</span>
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
									<span>{state.trace.metrics.errors}</span>
								</div>
								{#each visible_events
									.filter(event_has_error)
									.slice(0, 8) as event (event.event_id)}<button
										class="compact-row artifact"
										onclick={() => (state.selected_event = event)}
										><strong>{summary(event)}</strong><span>#{event.seq}</span
										></button
									>{:else}<p class="empty compact">
										No error observations.
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
					</section>
				{:else if state.selected_view === "waterfall"}
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
						</div>
					</section>
				{:else if state.selected_view === "events"}
					<section class="panel events-panel">
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
						<div class="events full">
							{#each visible_events.slice(0, 400) as event (event.event_id)}<button
									class:error={event_has_error(event)}
									class="event"
									onclick={() => (state.selected_event = event)}
									><span class="pill">#{event.seq}</span><strong
										>{event.type}</strong
									><small>{time(event.ts)}</small>
									<p>{summary(event)}</p></button
								>{/each}
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
					Select a session to inspect timeline, waterfall, and event details.
				</div>{/if}
		</section>

		<EventDrawer />
	</main>
</div>
