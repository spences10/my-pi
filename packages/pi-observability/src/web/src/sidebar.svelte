<script lang="ts">
	import type { DashboardSession } from "../../types";
	import {
		dashboard_state,
		is_active_session,
		number_crunch,
		select_session,
		time,
	} from "./dashboard-state.svelte";

	type NamedSession = DashboardSession & { session_name?: string };
	type Group = { name: string; sessions: DashboardSession[] };
	let { groups }: { groups: Group[] } = $props();

	function compact_session_id(session_id: string) {
		return session_id.length > 8 ? `${session_id.slice(0, 8)}…` : session_id;
	}

	function display_session_name(session: DashboardSession) {
		return (
			(session as NamedSession).session_name ||
			session.agent_name ||
			compact_session_id(session.session_id)
		);
	}
	const active_count = $derived(
		dashboard_state.sessions.filter((session) => is_active_session(session))
			.length,
	);
</script>

<aside class="sidebar" aria-label="Session browser">
	<div class="sidebar-head">
		<div class="sidebar-title">
			<strong>Sessions</strong>
			<span
				>{number_crunch(active_count)} live / {number_crunch(
					dashboard_state.sessions.length,
				)} total</span
			>
		</div>
		<input
			bind:value={dashboard_state.query}
			aria-label="Search sessions"
			name="session-search"
			placeholder="Search repo, agent, model…"
		/>
	</div>
	<div class="session-list">
		{#each groups as group (group.name)}
			<details class="project-group" open>
				<summary>
					<span><i></i><strong>{group.name}</strong></span>
					<small>{number_crunch(group.sessions.length)}</small>
				</summary>
				<div class="project-sessions">
					{#each group.sessions as session (session.session_id)}
						<button
							class:active={session.session_id === dashboard_state.selected_id}
							class="session"
							onclick={() => select_session(session.session_id)}
							title={`${session.session_id}\n${session.cwd}\nLast event: ${time(session.last_ts)}`}
						>
							<span class="session-main">
								<span class="title-line">
									{#if is_active_session(session)}<i aria-label="Active session"
										></i>{/if}
									<strong>{display_session_name(session)}</strong>
								</span>
								<small
									>{session.model ||
										session.provider ||
										session.pool ||
										"default"}</small
								>
							</span>
							<span class="session-meta">
								<strong>{number_crunch(session.event_count)}</strong>
								<small>{time(session.last_ts)}</small>
							</span>
						</button>
					{/each}
				</div>
			</details>
		{:else}
			<p class="sidebar-empty">No sessions match this search.</p>
		{/each}
	</div>
</aside>

<style>
	.sidebar {
		position: sticky;
		top: var(--topbar-height);
		height: calc(100vh - var(--topbar-height));
		border-right: 1px solid var(--border-muted);
		background: color-mix(in srgb, var(--surface), var(--bg) 38%);
		display: flex;
		flex-direction: column;
	}
	.sidebar-head {
		display: grid;
		gap: 12px;
		padding: 15px 14px 13px;
		border-bottom: 1px solid var(--border-muted);
	}
	.sidebar-title {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}
	.sidebar-title strong {
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.sidebar-title span {
		color: var(--muted);
		font-family: var(--font-mono);
		font-size: var(--font-size-label);
	}
	.sidebar-head input {
		padding-block: 8px;
		border-radius: 6px;
		font-size: var(--font-size-compact);
	}
	.session-list {
		min-height: 0;
		padding: 9px 8px 18px;
		overflow-y: auto;
		flex: 1 1 auto;
	}
	.project-group + .project-group {
		margin-top: 8px;
	}
	.project-group summary {
		list-style: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 7px 7px 6px;
		color: var(--muted);
		font-size: var(--font-size-compact);
	}
	.project-group summary::-webkit-details-marker {
		display: none;
	}
	.project-group summary > span {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
	}
	.project-group summary i {
		width: 6px;
		height: 6px;
		border-right: 1px solid currentColor;
		border-bottom: 1px solid currentColor;
		transform: rotate(45deg) translateY(-2px);
	}
	.project-group:not([open]) summary i {
		transform: rotate(-45deg);
	}
	.project-group summary strong {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
	}
	.project-group summary small {
		font-family: var(--font-mono);
	}
	.project-sessions {
		display: grid;
		gap: 2px;
	}
	.session {
		width: 100%;
		min-height: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 10px;
		padding: 8px 8px 8px 10px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		text-align: left;
	}
	.session:hover {
		background: color-mix(in srgb, var(--surface-2), transparent 16%);
		box-shadow: none;
	}
	.session.active {
		background: color-mix(in srgb, var(--selected), var(--surface) 91%);
		box-shadow: inset 2px 0 0 var(--selected);
	}
	.session-main,
	.title-line {
		min-width: 0;
	}
	.session-main {
		display: grid;
		gap: 2px;
	}
	.title-line {
		display: flex;
		align-items: center;
		gap: 7px;
	}
	.title-line strong,
	.session-main small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.title-line i {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--green);
		box-shadow: 0 0 8px color-mix(in srgb, var(--green), transparent 15%);
		flex: 0 0 auto;
	}
	.session-main small,
	.session-meta small {
		color: var(--muted);
		font-size: var(--font-size-label);
	}
	.session-meta {
		display: grid;
		justify-items: end;
		gap: 1px;
		font-family: var(--font-mono);
	}
	.session-meta strong {
		font-size: var(--font-size-compact);
		font-weight: 400;
	}
	.sidebar-empty {
		padding: 16px 8px;
		color: var(--muted);
		font-size: var(--font-size-compact);
	}
	@media (max-width: 900px) {
		.sidebar {
			position: static;
			height: auto;
			max-height: 290px;
			border-right: 0;
			border-bottom: 1px solid var(--border-muted);
		}
		.sidebar-head {
			grid-template-columns: auto minmax(220px, 1fr);
			align-items: center;
		}
		.session-list {
			display: flex;
			gap: 12px;
			overflow-x: auto;
		}
		.project-group {
			min-width: 300px;
		}
	}
	@media (max-width: 620px) {
		.sidebar-head {
			grid-template-columns: 1fr;
		}
	}
</style>
