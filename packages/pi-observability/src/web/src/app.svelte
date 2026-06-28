<script lang="ts">
	import { onMount } from "svelte";
	import type { DashboardSession } from "../../types";
	import {
		connect,
		dashboard_state,
		duration,
		extract_artifacts,
		is_active_session,
		load_sessions,
		money,
		number_crunch,
		payload_value,
		query_matches,
		read_details_setting,
		read_theme,
		repo_name,
		session_title,
		text_preview,
		time,
		toggle_details_open,
	} from "./dashboard-state.svelte";
	import { build_turns } from "./event-analysis";
	import EventDrawer from "./event-drawer.svelte";
	import EventsView from "./events-view.svelte";
	import HeaderBar from "./header-bar.svelte";
	import Sidebar from "./sidebar.svelte";
	import TimelineView from "./timeline-view.svelte";
	import WaterfallView from "./waterfall-view.svelte";

	type Session = DashboardSession;
	const visible_sessions = $derived.by(() => {
		const parts = dashboard_state.query
			.toLowerCase()
			.split(/\s+/)
			.filter(Boolean);
		return dashboard_state.sessions
			.filter((session) => {
				const fields = {
					id: session.session_id,
					agent: session.agent_name || "",
					repo: repo_name(session),
					cwd: session.cwd || "",
					pool: session.pool || "default",
					provider: session.provider || "",
					model: session.model || "",
					active: is_active_session(session) ? "true" : "false",
				};
				const text = Object.values(fields).join(" ").toLowerCase();
				return parts.every((part) => {
					const [key, ...rest] = part.split(":");
					const value = rest.join(":");
					if (!value) return text.includes(key);
					return (fields[key as keyof typeof fields] || "")
						.toLowerCase()
						.includes(value);
				});
			})
			.sort((a, b) => {
				const active =
					Number(is_active_session(b)) - Number(is_active_session(a));
				if (active) return active;
				return b.last_ts.localeCompare(a.last_ts);
			});
	});
	const known_types = $derived(
		[...new Set(dashboard_state.events.map((event) => event.type))].sort(
			(a, b) => a.localeCompare(b),
		),
	);
	const visible_events = $derived(
		dashboard_state.events.filter(
			(event) =>
				(!dashboard_state.selected_type ||
					event.type === dashboard_state.selected_type) &&
				query_matches(event, dashboard_state.event_query),
		),
	);
	const max_span = $derived(
		Math.max(
			1,
			...(dashboard_state.trace?.spans ?? []).map((span) => span.duration_ms),
		),
	);
	const grouped_sessions = $derived.by(() => {
		const groups: Record<string, { name: string; sessions: Session[] }> = {};
		for (const session of visible_sessions) {
			const name = repo_name(session);
			groups[name] ??= { name, sessions: [] };
			groups[name].sessions.push(session);
		}
		return Object.values(groups);
	});
	const tool_spans = $derived(
		(dashboard_state.trace?.spans ?? [])
			.filter((span) => span.kind === "tool")
			.slice(0, 8),
	);
	const provider_spans = $derived(
		(dashboard_state.trace?.spans ?? [])
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
	const initial_agent_event = $derived.by(() =>
		[...visible_events]
			.sort((a, b) => a.seq - b.seq)
			.find((event) => event.type === "agent_start"),
	);
	const provider_request = $derived(
		visible_events.find((event) => event.type === "provider_request"),
	);
	const reasoning = $derived(
		payload_value(provider_request?.payload, "payload.reasoning") ||
			payload_value(provider_request?.payload, "reasoning"),
	);
	const session_file = $derived(
		dashboard_state.trace?.session?.session_file ||
			dashboard_state.events.find((event) => event.session_file)?.session_file,
	);
	const first_event_ts = $derived(
		dashboard_state.trace?.session?.first_ts || visible_events.at(-1)?.ts,
	);

	async function copy_session_id() {
		if (!dashboard_state.selected_id) return;
		await navigator.clipboard.writeText(dashboard_state.selected_id);
	}

	onMount(() => {
		read_theme();
		read_details_setting();
		void load_sessions();
		return connect();
	});
</script>

<svelte:head><title>Pi Observability</title></svelte:head>

<div class:light={dashboard_state.theme === "light"} class="app-shell">
	<HeaderBar />

	<main>
		<Sidebar groups={grouped_sessions} />

		<section class="content">
			{#if dashboard_state.trace}
				<section class="hero panel">
					<div>
						<p class="eyebrow">Selected session</p>
						<h2>
							{dashboard_state.trace.session
								? session_title(dashboard_state.trace.session)
								: dashboard_state.selected_id}
						</h2>
						<p>{dashboard_state.trace.session?.cwd}</p>
					</div>
					<div class="metric-grid">
						<div>
							<strong
								>{number_crunch(dashboard_state.trace.metrics.events)}</strong
							><span>events</span>
						</div>
						<div>
							<strong
								>{duration(dashboard_state.trace.metrics.elapsed_ms)}</strong
							><span>elapsed</span>
						</div>
						<div>
							<strong
								>{duration(dashboard_state.trace.metrics.blocking_ms)}</strong
							><span>blocking</span>
						</div>
						<div>
							<strong
								>{number_crunch(dashboard_state.trace.metrics.errors)}</strong
							><span>errors</span>
						</div>
						<div>
							<strong
								>{number_crunch(
									dashboard_state.trace.metrics.total_tokens,
								)}</strong
							><span>tokens</span>
						</div>
						<div>
							<strong>{money(dashboard_state.trace.metrics.cost_usd)}</strong
							><span>cost</span>
						</div>
					</div>
				</section>

				<section class="session-details panel">
					<div class="details-head compact-head">
						<p class="eyebrow">Session context</p>
						<button onclick={toggle_details_open}>
							{dashboard_state.details_open ? "Hide details" : "Show details"}
						</button>
					</div>
					{#if dashboard_state.details_open}
						<div class="detail-strip">
							<span>
								<b>Repo</b>
								{dashboard_state.trace.session
									? repo_name(dashboard_state.trace.session)
									: "—"}
							</span>
							<span>
								<b>Model</b>
								{dashboard_state.trace.session?.model || "—"}
							</span>
							<span>
								<b>Provider</b>
								{dashboard_state.trace.session?.provider || "—"}
							</span>
							<span><b>Thinking</b> {text_preview(reasoning, 80) || "—"}</span>
							<span>
								<b>Events</b>
								{first_event_ts ? time(first_event_ts) : "—"} → {dashboard_state
									.trace.session
									? time(dashboard_state.trace.session.last_ts)
									: "—"}
							</span>
						</div>
						<details class="technical-details">
							<summary>Technical details</summary>
							<div>
								<span>
									<b>CWD</b>
									<code>{dashboard_state.trace.session?.cwd || "—"}</code>
								</span>
								<span>
									<b>Pool</b>
									{dashboard_state.trace.session?.pool || "default"}
								</span>
								<span>
									<b>Tags</b>
									{dashboard_state.trace.session?.tags?.join(" · ") || "—"}
								</span>
								<span>
									<b>Session id</b> <code>{dashboard_state.selected_id}</code>
									<button onclick={copy_session_id}>Copy</button>
								</span>
								<span>
									<b>Session file</b> <code>{session_file || "—"}</code>
								</span>
							</div>
						</details>
						{#if initial_agent_event}
							<div class="prompt-grid">
								<details open>
									<summary>Initial user prompt</summary>
									<pre>{text_preview(
											initial_agent_event.payload.prompt,
											4000,
										) || "—"}</pre>
								</details>
								<details>
									<summary>Initial system prompt</summary>
									<pre>{text_preview(
											initial_agent_event.payload.systemPrompt,
											8000,
										) || "—"}</pre>
								</details>
							</div>
						{/if}
					{/if}
				</section>

				<nav class="view-tabs">
					<button
						class:active={dashboard_state.selected_view === "timeline"}
						onclick={() => (dashboard_state.selected_view = "timeline")}
					>
						Timeline
					</button>
					<button
						class:active={dashboard_state.selected_view === "waterfall"}
						onclick={() => (dashboard_state.selected_view = "waterfall")}
					>
						Waterfall
					</button>
					<button
						class:active={dashboard_state.selected_view === "events"}
						onclick={() => (dashboard_state.selected_view = "events")}
					>
						Events
					</button>
				</nav>

				<div class="view-body">
					{#if dashboard_state.selected_view === "timeline"}
						<TimelineView
							{artifacts}
							{final_outputs}
							{known_types}
							{turns}
							{visible_events}
						/>
					{:else if dashboard_state.selected_view === "waterfall"}
						<WaterfallView {max_span} {provider_spans} {tool_spans} />
					{:else}
						<EventsView {known_types} {visible_events} />
					{/if}
				</div>
			{:else}
				<div class="panel empty">
					Select a session to inspect timeline, waterfall, and event details.
				</div>
			{/if}
		</section>

		<EventDrawer />
	</main>
</div>

<style>
	.hero {
		display: flex;
		flex: 0 0 auto;
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
		font-size: var(--font-size-compact);
	}
	.session-details {
		flex: 0 0 auto;
		margin-bottom: 14px;
		padding: 16px;
	}
	.details-head {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		align-items: center;
		margin-bottom: 10px;
	}
	.compact-head button,
	.technical-details button {
		min-height: 0;
		padding: 5px 8px;
		font-size: var(--font-size-compact);
	}
	.detail-strip {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 18px;
		color: var(--text);
	}
	.detail-strip span,
	.technical-details span {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.detail-strip b,
	.technical-details b {
		color: var(--muted);
		font-size: var(--font-size-label);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		margin-right: 5px;
	}
	.technical-details {
		margin-top: 8px;
		color: var(--muted);
	}
	.technical-details summary {
		cursor: pointer;
		font-size: var(--font-size-compact);
	}
	.technical-details div {
		display: grid;
		gap: 6px;
		margin-top: 8px;
	}
	.prompt-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
		margin-top: 10px;
	}
	.prompt-grid details {
		min-width: 0;
		background: var(--bg);
		border: 1px solid var(--border-muted);
		border-radius: 12px;
		padding: 10px;
	}
	.prompt-grid summary {
		cursor: pointer;
		color: var(--muted);
	}
	.prompt-grid pre {
		max-height: 220px;
		margin: 10px 0 0;
		overflow: auto;
		white-space: pre-wrap;
		font-family: var(--font-mono);
		font-size: var(--font-size-compact);
	}
	.view-tabs {
		display: flex;
		gap: 10px;
		margin: 0 0 14px;
		flex: 0 0 auto;
	}
	.view-body {
		min-height: 0;
		flex: 1 1 auto;
		overflow-y: auto;
	}
	@media (max-width: 1200px) {
		.hero {
			display: block;
		}
		.metric-grid,
		.prompt-grid {
			grid-template-columns: repeat(2, 1fr);
			margin-top: 16px;
		}
	}
	@media (max-width: 720px) {
		.metric-grid,
		.prompt-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
