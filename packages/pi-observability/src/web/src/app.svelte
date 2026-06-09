<script lang="ts">
	import { onMount } from "svelte";
	import type {
		DashboardSession,
		ObservabilityEvent,
		TraceSummary,
	} from "../../types";

	type Event = ObservabilityEvent<Record<string, unknown>>;
	type Session = DashboardSession;
	type Trace = TraceSummary;

	const token = new URLSearchParams(location.search).get("token") || "";
	let sessions = $state.raw<Session[]>([]);
	let events = $state.raw<Event[]>([]);
	let trace = $state.raw<Trace | null>(null);
	let selected_id = $state("");
	let connected = $state(false);
	let paused = $state(false);
	let query = $state("");
	let event_query = $state("");
	let selected_event = $state<Event | null>(null);

	const visible_sessions = $derived(
		sessions.filter((session) =>
			[
				session.session_id,
				session.agent_name,
				session.cwd,
				session.pool,
				session.provider,
				session.model,
				...(session.tags || []),
			]
				.filter(Boolean)
				.join(" ")
				.toLowerCase()
				.includes(query.toLowerCase()),
		),
	);
	const visible_events = $derived(
		events.filter(
			(event) =>
				!event_query ||
				`${event.type} ${summary(event)} ${JSON.stringify(event.payload)}`
					.toLowerCase()
					.includes(event_query.toLowerCase()),
		),
	);
	const max_span = $derived(
		Math.max(1, ...(trace?.spans ?? []).map((span) => span.duration_ms)),
	);

	function api(path: string) {
		return `${path}${token ? `${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : ""}`;
	}
	function label(session: Session) {
		return (session.agent_name || session.session_id).slice(0, 44);
	}
	function time(value: string) {
		const date = new Date(value);
		return Number.isNaN(date.valueOf()) ? value : date.toLocaleTimeString();
	}
	function duration(ms = 0) {
		if (!ms) return "—";
		if (ms < 1000) return `${Math.round(ms)}ms`;
		if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
		return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
	}
	function summary(event: Event) {
		const payload = event.payload || {};
		const value =
			payload.tool_name ||
			payload.toolName ||
			payload.name ||
			payload.message ||
			payload.summary ||
			payload.error ||
			JSON.stringify(payload);
		return String(value ?? "").slice(0, 180);
	}
	async function load_sessions() {
		const response = await fetch(api("/sessions"));
		const body = await response.json();
		sessions = body.sessions || [];
		if (!selected_id && sessions[0])
			await select_session(sessions[0].session_id);
	}
	async function select_session(id: string) {
		selected_id = id;
		selected_event = null;
		const [events_response, trace_response] = await Promise.all([
			fetch(api(`/sessions/${encodeURIComponent(id)}/events?limit=500`)),
			fetch(api(`/sessions/${encodeURIComponent(id)}/trace`)),
		]);
		events = (await events_response.json()).events || [];
		trace = await trace_response.json();
	}
	function connect() {
		const source = new EventSource(api("/events/stream"));
		source.addEventListener("hello", () => (connected = true));
		source.addEventListener("event", (message) => {
			const event = JSON.parse(message.data) as Event;
			if (paused) return;
			void load_sessions();
			if (event.session_id === selected_id) void select_session(selected_id);
		});
		source.onerror = () => {
			connected = false;
			source.close();
			setTimeout(connect, 1500);
		};
		return () => source.close();
	}
	onMount(() => {
		void load_sessions();
		return connect();
	});
</script>

<header>
	<div>
		<p class="eyebrow">Local agent telemetry</p>
		<h1>Pi Observability</h1>
	</div>
	<div class="toolbar">
		<span class:live={connected} class="status"
			>{connected ? "live" : "reconnecting"}</span
		><button onclick={() => (paused = !paused)}
			>{paused ? "Resume" : "Pause"}</button
		>
	</div>
</header>

<main>
	<aside>
		<div class="panel sticky">
			<input bind:value={query} placeholder="Filter sessions, pools, models…" />
			<div class="stats">
				<strong>{sessions.length}</strong><span>sessions</span><strong
					>{sessions.reduce(
						(sum, session) => sum + Number(session.event_count || 0),
						0,
					)}</strong
				><span>events</span>
			</div>
		</div>
		<div class="session-list">
			{#each visible_sessions as session (session.session_id)}
				<button
					class:active={session.session_id === selected_id}
					class="session"
					onclick={() => select_session(session.session_id)}
				>
					<strong>{label(session)}</strong><span>
						{session.pool || "default"} · {session.event_count} events
					</span><small>{session.cwd}</small></button
				>
			{/each}
		</div>
	</aside>

	<section class="content">
		{#if trace}
			<section class="hero panel">
				<div>
					<p class="eyebrow">Selected trace</p>
					<h2>{trace.session ? label(trace.session) : selected_id}</h2>
					<p>{trace.session?.cwd}</p>
				</div>
				<div class="metric-grid">
					<div><strong>{trace.metrics.events}</strong><span>events</span></div>
					<div>
						<strong>{duration(trace.metrics.elapsed_ms)}</strong><span>
							elapsed
						</span>
					</div>
					<div>
						<strong>{duration(trace.metrics.blocking_ms)}</strong><span>
							blocking
						</span>
					</div>
					<div><strong>{trace.metrics.errors}</strong><span>errors</span></div>
					<div>
						<strong>{trace.metrics.total_tokens || "—"}</strong><span>
							tokens
						</span>
					</div>
					<div>
						<strong>
							{trace.metrics.cost_usd
								? `$${trace.metrics.cost_usd.toFixed(3)}`
								: "—"}
						</strong><span>cost</span>
					</div>
				</div>
			</section>
			<section class="grid">
				<div class="panel span-panel">
					<div class="panel-head">
						<h3>Waterfall bottlenecks</h3>
						<span>{trace.spans.length} spans</span>
					</div>
					{#each trace.spans as span (span.id)}<div
							class:error={span.error}
							class="span-row"
						>
							<div class="span-label">
								<strong>{span.name}</strong><span>
									{span.kind} · {span.event_count} events
								</span>
							</div>
							<div class="bar">
								<i
									style:width={`${Math.max(4, (span.duration_ms / max_span) * 100)}%`}
								></i>
							</div>
							<time>{duration(span.duration_ms)}</time>
						</div>{/each}
				</div>
				<div class="panel events-panel">
					<div class="panel-head">
						<h3>Event stream</h3>
						<input
							bind:value={event_query}
							placeholder="Search type, tool, payload…"
						/>
					</div>
					<div class="events">
						{#each visible_events.slice(0, 160) as event (event.event_id)}<button
								class="event"
								onclick={() => (selected_event = event)}
								><span class="pill">#{event.seq}</span><strong>
									{event.type}
								</strong><small>{time(event.ts)}</small>
								<p>{summary(event)}</p></button
							>
						{/each}
					</div>
				</div>
			</section>
		{:else}<div class="panel empty">
				Select a session to inspect trace bottlenecks.
			</div>{/if}
	</section>

	{#if selected_event}<aside class="drawer">
			<button class="close" onclick={() => (selected_event = null)}>
				Close
			</button>
			<h3>{selected_event.type} #{selected_event.seq}</h3>
			<p>{time(selected_event.ts)}</p>
			<pre>{JSON.stringify(selected_event.payload, null, 2)}</pre>
		</aside>
	{/if}
</main>
