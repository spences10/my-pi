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

	type Session = DashboardSession & { session_name?: string };
	type OptionalMetrics = {
		turns?: number;
		tool_calls?: number;
		tool_failures?: number;
		tools?: number;
	};
	type ToolSummary = {
		name: string;
		calls: number;
		errors: number;
		total_duration_ms: number;
		avg_duration_ms: number;
		max_duration_ms: number;
	};

	function compact_session_id(session_id: string) {
		return session_id.length > 8 ? `${session_id.slice(0, 8)}…` : session_id;
	}

	function display_session_name(session: Session) {
		return (
			session.session_name ||
			session.agent_name ||
			compact_session_id(session.session_id)
		);
	}

	const visible_sessions = $derived.by(() => {
		const parts = dashboard_state.query
			.toLowerCase()
			.split(/\s+/)
			.filter(Boolean);
		return dashboard_state.sessions
			.filter((session) => {
				const named_session = session as Session;
				const fields = {
					id: session.session_id,
					name: named_session.session_name || "",
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
			.slice(0, 12),
	);
	const provider_spans = $derived(
		(dashboard_state.trace?.spans ?? [])
			.filter((span) => span.kind === "provider")
			.slice(0, 8),
	);
	const optional_metrics = $derived(
		dashboard_state.trace?.metrics as
			| (NonNullable<typeof dashboard_state.trace>["metrics"] & OptionalMetrics)
			| undefined,
	);
	const tool_summaries = $derived(
		((dashboard_state.trace as unknown as { tools?: ToolSummary[] } | null)
			?.tools ?? []) as ToolSummary[],
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
	const loaded_events = $derived(dashboard_state.trace?.metrics.events ?? 0);
	const session_events = $derived(
		dashboard_state.trace?.session?.event_count ?? loaded_events,
	);
	const partial_trace = $derived(session_events > loaded_events);

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
				<section class="session-overview">
					<div class="session-heading">
						<div class="session-title">
							<p class="breadcrumb">
								<span>
									{dashboard_state.trace.session
										? repo_name(dashboard_state.trace.session)
										: "session"}
								</span>
								<span>/</span>
								<span>{dashboard_state.trace.session?.pool || "default"}</span>
							</p>
							<h2>
								{dashboard_state.trace.session
									? display_session_name(
											dashboard_state.trace.session as Session,
										)
									: compact_session_id(dashboard_state.selected_id)}
							</h2>
							<p class="session-path">{dashboard_state.trace.session?.cwd}</p>
						</div>
						<div class="coverage" class:partial={partial_trace}>
							<span>{partial_trace ? "Partial trace" : "Trace loaded"}</span>
							<strong>
								{number_crunch(loaded_events)}{partial_trace
									? ` / ${number_crunch(session_events)}`
									: ""}
							</strong>
							<small>events in view</small>
						</div>
					</div>

					<div class="metric-strip" aria-label="Session metrics">
						<div>
							<span>Turns</span>
							<strong>
								{number_crunch(optional_metrics?.turns ?? turns.length)}
							</strong>
						</div>
						<div>
							<span>Tool calls</span>
							<strong>
								{number_crunch(
									optional_metrics?.tool_calls ??
										optional_metrics?.tools ??
										tool_spans.length,
								)}
							</strong>
						</div>
						<div class:has-error={(optional_metrics?.tool_failures ?? 0) > 0}>
							<span>Tool failures</span>
							<strong>
								{number_crunch(optional_metrics?.tool_failures ?? 0)}
							</strong>
						</div>
						<div>
							<span>Elapsed</span>
							<strong>{duration(optional_metrics?.elapsed_ms)}</strong>
						</div>
						<div>
							<span>Tokens</span>
							<strong>
								{number_crunch(optional_metrics?.total_tokens ?? 0)}
							</strong>
						</div>
						<div>
							<span>Cost</span>
							<strong>{money(optional_metrics?.cost_usd)}</strong>
						</div>
					</div>

					<div class="context-bar">
						<div class="context-facts">
							<span>
								<b>Model</b>
								{dashboard_state.trace.session?.model || "—"}
							</span>
							<span>
								<b>Provider</b>
								{dashboard_state.trace.session?.provider || "—"}
							</span>
							<span><b>Thinking</b> {text_preview(reasoning, 48) || "—"}</span>
							<span>
								<b>Range</b>
								{first_event_ts ? time(first_event_ts) : "—"} → {dashboard_state
									.trace.session
									? time(dashboard_state.trace.session.last_ts)
									: "—"}
							</span>
						</div>
						<button class="text-button" onclick={toggle_details_open}>
							{dashboard_state.details_open
								? "Close context"
								: "Inspect context"}
						</button>
					</div>

					{#if dashboard_state.details_open}
						<div class="context-details">
							<div class="technical-grid">
								<span>
									<b>CWD</b><code>
										{dashboard_state.trace.session?.cwd || "—"}
									</code>
								</span>
								<span
									><b>Tags</b>{dashboard_state.trace.session?.tags?.join(
										" · ",
									) || "—"}</span
								>
								<span
									><b>Session id</b><code>{dashboard_state.selected_id}</code
									><button class="copy-button" onclick={copy_session_id}
										>Copy</button
									></span
								>
								<span
									><b>Session file</b><code>{session_file || "—"}</code></span
								>
							</div>
							{#if initial_agent_event}
								<div class="prompt-grid">
									<details>
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
						</div>
					{/if}
				</section>

				<nav class="view-tabs" aria-label="Session views">
					<button
						class:active={dashboard_state.selected_view === "timeline"}
						onclick={() => (dashboard_state.selected_view = "timeline")}
					>
						<span>Overview</span><small
							>{number_crunch(optional_metrics?.turns ?? turns.length)} turns</small
						>
					</button>
					<button
						class:active={dashboard_state.selected_view === "waterfall"}
						onclick={() => (dashboard_state.selected_view = "waterfall")}
					>
						<span>Performance</span><small
							>{number_crunch(
								optional_metrics?.tool_calls ??
									optional_metrics?.tools ??
									tool_spans.length,
							)} calls</small
						>
					</button>
					<button
						class:active={dashboard_state.selected_view === "events"}
						onclick={() => (dashboard_state.selected_view = "events")}
					>
						<span>Events</span><small
							>{number_crunch(visible_events.length)} loaded</small
						>
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
						<WaterfallView
							{max_span}
							{provider_spans}
							{tool_spans}
							tools={tool_summaries}
						/>
					{:else}
						<EventsView {known_types} {visible_events} />
					{/if}
				</div>
			{:else}
				<div class="empty-state">
					<p class="eyebrow">No session selected</p>
					<h2>Choose a trace to start debugging.</h2>
					<p>
						Inspect turns, tool performance, failures, and raw lifecycle events.
					</p>
				</div>
			{/if}
		</section>

		<EventDrawer />
	</main>
</div>

<style>
	.session-overview {
		flex: 0 0 auto;
	}
	.session-heading {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 24px;
		padding: 4px 2px 18px;
	}
	.session-title {
		min-width: 0;
	}
	.breadcrumb {
		display: flex;
		gap: 7px;
		margin-bottom: 7px;
		color: var(--muted);
		font-family: var(--font-mono);
		font-size: var(--font-size-label);
		text-transform: uppercase;
		letter-spacing: 0.09em;
	}
	h2 {
		font-size: clamp(20px, 1.65vw, 27px);
		line-height: 1.12;
		letter-spacing: -0.035em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.session-path {
		margin-top: 6px;
		color: var(--muted);
		font-family: var(--font-mono);
		font-size: var(--font-size-compact);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.coverage {
		display: grid;
		grid-template-columns: auto auto;
		column-gap: 10px;
		align-items: baseline;
		min-width: max-content;
		padding-left: 16px;
		border-left: 2px solid var(--green);
	}
	.coverage.partial {
		border-color: var(--yellow);
	}
	.coverage span,
	.coverage small {
		color: var(--muted);
		font-size: var(--font-size-label);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.coverage strong {
		grid-row: span 2;
		font: 700 18px/1 var(--font-mono);
	}
	.metric-strip {
		display: grid;
		grid-template-columns: repeat(6, minmax(100px, 1fr));
		border-block: 1px solid var(--border-muted);
	}
	.metric-strip > div {
		display: grid;
		gap: 3px;
		padding: 13px 16px 12px;
		border-right: 1px solid var(--border-muted);
	}
	.metric-strip > div:first-child {
		padding-left: 2px;
	}
	.metric-strip > div:last-child {
		border-right: 0;
	}
	.metric-strip span {
		color: var(--muted);
		font-size: var(--font-size-label);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.metric-strip strong {
		font: 700 19px/1.2 var(--font-mono);
	}
	.metric-strip .has-error strong {
		color: var(--red);
	}
	.context-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		min-height: 42px;
		border-bottom: 1px solid var(--border-muted);
	}
	.context-facts {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 20px;
		min-width: 0;
	}
	.context-facts span {
		color: var(--text);
		font-size: var(--font-size-compact);
	}
	.context-facts b,
	.technical-grid b {
		margin-right: 6px;
		color: var(--muted);
		font-size: var(--font-size-label);
		text-transform: uppercase;
		letter-spacing: 0.07em;
	}
	.text-button,
	.copy-button {
		min-height: 0;
		padding: 4px 7px;
		border: 0;
		background: transparent;
		color: var(--cyan);
		font-size: var(--font-size-compact);
		white-space: nowrap;
	}
	.context-details {
		padding: 14px 0 16px;
		border-bottom: 1px solid var(--border-muted);
	}
	.technical-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px 24px;
		color: var(--muted);
		font-size: var(--font-size-compact);
	}
	.technical-grid span {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.technical-grid b {
		display: block;
		margin-bottom: 2px;
	}
	.prompt-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 20px;
		margin-top: 14px;
	}
	.prompt-grid details {
		min-width: 0;
		border-top: 1px solid var(--border-muted);
		padding-top: 9px;
	}
	.prompt-grid summary {
		cursor: pointer;
		color: var(--muted);
		font-size: var(--font-size-compact);
	}
	.prompt-grid pre {
		max-height: 180px;
		margin: 9px 0 0;
		overflow: auto;
		white-space: pre-wrap;
		font-family: var(--font-mono);
		font-size: var(--font-size-compact);
	}
	.view-tabs {
		display: flex;
		gap: 24px;
		margin-top: 4px;
		border-bottom: 1px solid var(--border-muted);
		flex: 0 0 auto;
	}
	.view-tabs button {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding: 13px 1px 11px;
		border: 0;
		border-bottom: 2px solid transparent;
		border-radius: 0;
		background: transparent;
		color: var(--muted);
	}
	.view-tabs button:hover,
	.view-tabs button.active {
		border-bottom-color: var(--focus);
		background: transparent;
		box-shadow: none;
		color: var(--text);
	}
	.view-tabs button.active span {
		color: var(--text);
	}
	.view-tabs small {
		font-family: var(--font-mono);
		font-size: var(--font-size-label);
	}
	.view-body {
		min-height: 0;
		flex: 1 1 auto;
		overflow-y: auto;
		padding-top: 16px;
	}
	.empty-state {
		max-width: 560px;
		margin: auto;
		padding: 12vh 24px;
	}
	.empty-state h2 {
		margin: 8px 0 12px;
	}
	.empty-state > p:last-child {
		color: var(--muted);
	}
	@media (max-width: 1180px) {
		.metric-strip {
			grid-template-columns: repeat(3, 1fr);
		}
		.metric-strip > div:nth-child(3) {
			border-right: 0;
		}
		.metric-strip > div:nth-child(-n + 3) {
			border-bottom: 1px solid var(--border-muted);
		}
		.metric-strip > div:nth-child(4) {
			padding-left: 2px;
		}
	}
	@media (max-width: 720px) {
		.session-heading {
			align-items: stretch;
			flex-direction: column;
			gap: 12px;
		}
		.coverage {
			align-self: flex-start;
		}
		.metric-strip {
			grid-template-columns: repeat(2, 1fr);
		}
		.metric-strip > div:nth-child(n) {
			padding-left: 10px;
			border-right: 1px solid var(--border-muted);
			border-bottom: 1px solid var(--border-muted);
		}
		.metric-strip > div:nth-child(even) {
			border-right: 0;
		}
		.metric-strip > div:nth-last-child(-n + 2) {
			border-bottom: 0;
		}
		.context-bar {
			align-items: flex-start;
			padding: 9px 0;
		}
		.technical-grid,
		.prompt-grid {
			grid-template-columns: 1fr;
		}
		.view-tabs {
			gap: 18px;
			overflow-x: auto;
		}
		.view-tabs button {
			min-width: max-content;
		}
	}
</style>
