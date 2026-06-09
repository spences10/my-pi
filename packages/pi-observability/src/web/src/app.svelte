<script lang="ts">
	import { onMount } from "svelte";
	import { SvelteMap } from "svelte/reactivity";
	import type {
		DashboardSession,
		ObservabilityEvent,
		TraceSummary,
	} from "../../types";

	type Event = ObservabilityEvent<Record<string, unknown>>;
	type Session = DashboardSession;
	type Trace = TraceSummary;
	type View = "trace" | "swimlane" | "race";
	type LabelMap = Record<string, string[]>;

	const token = new URLSearchParams(location.search).get("token") || "";
	const theme_key = "pi-observability-theme";
	const labels_key = "pi-observability-labels";
	let sessions = $state.raw<Session[]>([]);
	let events = $state.raw<Event[]>([]);
	let trace = $state.raw<Trace | null>(null);
	let selected_id = $state("");
	let connected = $state(false);
	let paused = $state(false);
	let query = $state("");
	let event_query = $state("");
	let selected_type = $state("");
	let selected_view = $state<View>("trace");
	let theme = $state<"dark" | "light">("dark");
	let selected_event = $state<Event | null>(null);
	let labels = $state.raw<LabelMap>({});
	let label_input = $state("");
	const event_cache = new SvelteMap<string, Event[]>();
	let session_reload_timer: ReturnType<typeof setTimeout> | null = null;
	let selected_reload_timer: ReturnType<typeof setTimeout> | null = null;

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
				...(labels[session.session_id] || []),
			]
				.filter(Boolean)
				.join(" ")
				.toLowerCase()
				.includes(query.toLowerCase()),
		),
	);
	const known_types = $derived(
		[...new Set(events.map((event) => event.type))].sort((a, b) =>
			a.localeCompare(b),
		),
	);
	const visible_events = $derived(
		events.filter(
			(event) =>
				(!selected_type || event.type === selected_type) &&
				query_matches(event, event_query),
		),
	);
	const max_span = $derived(
		Math.max(1, ...(trace?.spans ?? []).map((span) => span.duration_ms)),
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
				if (query_matches(event, event_query)) rows.push({ session, event });
			}
		}
		return rows.sort((a, b) => a.event.ts.localeCompare(b.event.ts));
	});
	const tool_spans = $derived(
		(trace?.spans ?? []).filter((span) => span.kind === "tool").slice(0, 8),
	);
	const provider_spans = $derived(
		(trace?.spans ?? []).filter((span) => span.kind === "provider").slice(0, 8),
	);
	const artifacts = $derived(extract_artifacts(visible_events).slice(0, 10));
	const final_outputs = $derived(
		visible_events
			.filter((event) =>
				["agent_end", "message_end", "session_shutdown"].includes(event.type),
			)
			.slice(0, 6),
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
	function payload_path(payload: Record<string, unknown>, path: string) {
		return path.split(".").reduce<unknown>((value, key) => {
			if (!value || typeof value !== "object") return undefined;
			return (value as Record<string, unknown>)[key];
		}, payload);
	}
	function query_matches(event: Event, query_text: string) {
		const parts = query_text.toLowerCase().split(/\s+/).filter(Boolean);
		if (!parts.length) return true;
		const text =
			`${event.type} ${summary(event)} ${JSON.stringify(event.payload)}`.toLowerCase();
		for (const part of parts) {
			const [key, ...rest] = part.split(":");
			const value = rest.join(":");
			if (!value) {
				if (!text.includes(key)) return false;
				continue;
			}
			if (key === "type" && !event.type.toLowerCase().includes(value))
				return false;
			if (key === "tool" && !text.includes(value)) return false;
			if (key === "status" && !text.includes(value)) return false;
			if (key === "json") {
				const [path, expected = ""] = value.split("=");
				if (
					!String(payload_path(event.payload, path) ?? "")
						.toLowerCase()
						.includes(expected)
				)
					return false;
			}
			if (
				!["type", "tool", "status", "json"].includes(key) &&
				!text.includes(part)
			)
				return false;
		}
		return true;
	}
	function extract_artifacts(source_events: Event[]) {
		const items: { event: Event; value: string }[] = [];
		for (const event of source_events) {
			const text = JSON.stringify(event.payload || {});
			const paths = [...text.matchAll(/(?:[\w.-]+\/)+[\w.-]+\.[\w.-]+/g)].map(
				(match) => match[0],
			);
			const urls = [...text.matchAll(/https?:\/\/[^\s"'<>]+/g)].map(
				(match) => match[0],
			);
			for (const value of [...paths, ...urls].slice(0, 4))
				items.push({ event, value });
		}
		return items;
	}
	function read_labels() {
		try {
			labels = JSON.parse(localStorage.getItem(labels_key) || "{}");
		} catch {
			labels = {};
		}
	}
	function save_labels(next: LabelMap) {
		labels = next;
		localStorage.setItem(labels_key, JSON.stringify(next));
	}
	function add_label() {
		const value = label_input.trim();
		if (!value || !selected_id) return;
		save_labels({
			...labels,
			[selected_id]: [...(labels[selected_id] || []), value],
		});
		label_input = "";
	}
	function remove_label(index: number) {
		if (!selected_id) return;
		const next = [...(labels[selected_id] || [])];
		next.splice(index, 1);
		save_labels({ ...labels, [selected_id]: next });
	}
	async function load_sessions() {
		const response = await fetch(api("/sessions"));
		const body = await response.json();
		sessions = body.sessions || [];
		if (!selected_id && sessions[0])
			await select_session(sessions[0].session_id);
	}
	async function fetch_events(id: string) {
		const response = await fetch(
			api(`/sessions/${encodeURIComponent(id)}/events?limit=500`),
		);
		const body = await response.json();
		const loaded = (body.events || []) as Event[];
		event_cache.set(id, loaded);
		if (id === selected_id) events = loaded;
		return loaded;
	}
	async function select_session(id: string) {
		selected_id = id;
		selected_event = null;
		const [loaded_events, trace_response] = await Promise.all([
			fetch_events(id),
			fetch(api(`/sessions/${encodeURIComponent(id)}/trace`)),
		]);
		events = loaded_events;
		trace = await trace_response.json();
	}
	async function load_comparison() {
		await Promise.all(
			comparison_sessions.map((session) => fetch_events(session.session_id)),
		);
	}
	function schedule_sessions_reload() {
		if (session_reload_timer) return;
		session_reload_timer = setTimeout(() => {
			session_reload_timer = null;
			void load_sessions();
		}, 1000);
	}
	function schedule_selected_reload() {
		if (!selected_id || selected_reload_timer) return;
		selected_reload_timer = setTimeout(() => {
			selected_reload_timer = null;
			void select_session(selected_id);
		}, 350);
	}
	function connect() {
		const source = new EventSource(api("/events/stream"));
		source.addEventListener("hello", () => (connected = true));
		source.addEventListener("event", (message) => {
			const event = JSON.parse(message.data) as Event;
			if (paused) return;
			const cached = event_cache.get(event.session_id) || [];
			if (!cached.some((item) => item.event_id === event.event_id)) {
				event_cache.set(event.session_id, [event, ...cached].slice(0, 500));
				if (event.session_id === selected_id)
					events = event_cache.get(event.session_id) || [];
			}
			schedule_sessions_reload();
			if (event.session_id === selected_id) schedule_selected_reload();
		});
		source.onerror = () => {
			connected = false;
			source.close();
			setTimeout(connect, 1500);
		};
		return () => source.close();
	}
	onMount(() => {
		theme = localStorage.getItem(theme_key) === "light" ? "light" : "dark";
		read_labels();
		void load_sessions();
		return connect();
	});
</script>

<svelte:head><title>Pi Observability</title></svelte:head>

<div class:light={theme === "light"} class="app-shell">
	<header>
		<div>
			<p class="eyebrow">Neon Afterglow telemetry</p>
			<h1>Pi Observability</h1>
		</div>
		<div class="toolbar">
			<span class:live={connected} class="status"
				>{connected ? "live" : "reconnecting"}</span
			>
			<button
				onclick={() => {
					theme = theme === "dark" ? "light" : "dark";
					localStorage.setItem(theme_key, theme);
				}}>{theme === "dark" ? "Light" : "Dark"}</button
			>
			<button onclick={() => (paused = !paused)}
				>{paused ? "Resume" : "Pause"}</button
			>
		</div>
	</header>

	<main>
		<aside class="sidebar">
			<div class="panel sticky">
				<input
					bind:value={query}
					placeholder="Filter sessions, pools, models, labels…"
				/>
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
				{#each grouped_sessions as group (group.name)}
					<details class="project-group" open>
						<summary
							><strong>{group.name}</strong><span
								>{group.sessions.length} sessions</span
							></summary
						>
						{#each group.sessions as session (session.session_id)}
							<button
								class:active={session.session_id === selected_id}
								class="session"
								onclick={() => select_session(session.session_id)}
							>
								<strong>{label(session)}</strong><span
									>{session.pool || "default"} · {session.event_count} events</span
								><small>{session.cwd}</small>
								{#if labels[session.session_id]?.length}<small class="chips"
										>{labels[session.session_id].join(" · ")}</small
									>{/if}
							</button>
						{/each}
					</details>
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
						<div>
							<strong>{trace.metrics.events}</strong><span>events</span>
						</div>
						<div>
							<strong>{duration(trace.metrics.elapsed_ms)}</strong><span
								>elapsed</span
							>
						</div>
						<div>
							<strong>{duration(trace.metrics.blocking_ms)}</strong><span
								>blocking</span
							>
						</div>
						<div>
							<strong>{trace.metrics.errors}</strong><span>errors</span>
						</div>
						<div>
							<strong>{trace.metrics.total_tokens || "—"}</strong><span
								>tokens</span
							>
						</div>
						<div>
							<strong
								>{trace.metrics.cost_usd
									? `$${trace.metrics.cost_usd.toFixed(3)}`
									: "—"}</strong
							><span>cost</span>
						</div>
					</div>
				</section>

				<nav class="view-tabs">
					<button
						class:active={selected_view === "trace"}
						onclick={() => (selected_view = "trace")}>Trace</button
					><button
						class:active={selected_view === "swimlane"}
						onclick={() => {
							selected_view = "swimlane";
							void load_comparison();
						}}>Swimlane</button
					><button
						class:active={selected_view === "race"}
						onclick={() => {
							selected_view = "race";
							void load_comparison();
						}}>Race</button
					>
				</nav>

				<section class="labels panel">
					<input
						bind:value={label_input}
						onkeydown={(event) => {
							if (event.key === "Enter") add_label();
						}}
						placeholder="Add labels or review notes…"
					/><button onclick={add_label}>Save note</button
					>{#each labels[selected_id] || [] as item, index (item + index)}<button
							class="label-chip"
							onclick={() => remove_label(index)}>{item} ×</button
						>{/each}
				</section>

				{#if selected_view === "trace"}
					<section class="insight-grid">
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
						<div class="panel">
							<div class="panel-head">
								<h3>Tool duration</h3>
								<span>{tool_spans.length}</span>
							</div>
							{#each tool_spans as span (span.id)}<div class="compact-row">
									<strong>{span.name}</strong><span
										>{duration(span.duration_ms)}</span
									>
								</div>{:else}<p class="empty compact">No tool spans.</p>{/each}
						</div>
						<div class="panel">
							<div class="panel-head">
								<h3>Provider calls</h3>
								<span>{provider_spans.length}</span>
							</div>
							{#each provider_spans as span (span.id)}<div class="compact-row">
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
									onclick={() => (selected_event = artifact.event)}
									><strong title={artifact.value}>{artifact.value}</strong><span
										>#{artifact.event.seq}</span
									></button
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
									onclick={() => (selected_event = event)}
									><strong>{summary(event)}</strong><span>{event.type}</span
									></button
								>{:else}<p class="empty compact">
									No final output events.
								</p>{/each}
						</div>
						<div class="panel events-panel">
							<div class="panel-head">
								<h3>Event stream</h3>
								<div class="filters">
									<select bind:value={selected_type}
										><option value="">All types</option
										>{#each known_types as type (type)}<option value={type}
												>{type}</option
											>{/each}</select
									><input
										bind:value={event_query}
										placeholder="type:, tool:, status:, json:path=value…"
									/>
								</div>
							</div>
							<div class="events">
								{#each visible_events.slice(0, 180) as event (event.event_id)}<button
										class="event"
										onclick={() => (selected_event = event)}
										><span class="pill">#{event.seq}</span><strong
											>{event.type}</strong
										><small>{time(event.ts)}</small>
										<p>{summary(event)}</p></button
									>{/each}
							</div>
						</div>
					</section>
				{:else if selected_view === "swimlane"}
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
									.filter((event) => query_matches(event, event_query))
									.slice(0, 60) as event (event.event_id)}<button
										class="lane-event"
										onclick={() => (selected_event = event)}
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
										onclick={() => (selected_event = row.event)}
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

		{#if selected_event}<aside class="drawer">
				<button class="close" onclick={() => (selected_event = null)}
					>Close</button
				>
				<h3>{selected_event.type} #{selected_event.seq}</h3>
				<p>{time(selected_event.ts)}</p>
				<pre>{JSON.stringify(selected_event.payload, null, 2)}</pre>
			</aside>{/if}
	</main>
</div>
