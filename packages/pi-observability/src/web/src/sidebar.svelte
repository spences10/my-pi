<script lang="ts">
	import type { DashboardSession } from "../../types";
	import {
		dashboard_state,
		is_active_session,
		label,
		number_crunch,
		select_session,
		time,
	} from "./dashboard-state.svelte";
	type Group = { name: string; sessions: DashboardSession[] };
	let { groups }: { groups: Group[] } = $props();
	const active_count = $derived(
		dashboard_state.sessions.filter((session) => is_active_session(session))
			.length,
	);
</script>

<aside class="sidebar">
	<div class="panel sticky">
		<input
			bind:value={dashboard_state.query}
			name="session-search"
			placeholder="Search sessions, repo, model, pool…"
		/>
		<div class="stats">
			<strong>{number_crunch(dashboard_state.sessions.length)}</strong><span
				>sessions</span
			>
			<strong>{number_crunch(active_count)}</strong><span>active</span>
			<strong>
				{number_crunch(
					dashboard_state.sessions.reduce(
						(sum, session) => sum + Number(session.event_count || 0),
						0,
					),
				)}
			</strong><span>events</span>
		</div>
	</div>
	<div class="session-list">
		{#each groups as group (group.name)}
			<details class="project-group" open>
				<summary>
					<strong>{group.name}</strong><span
						>{number_crunch(group.sessions.length)} sessions</span
					>
				</summary>
				{#each group.sessions as session (session.session_id)}
					<button
						class:active={session.session_id === dashboard_state.selected_id}
						class="session"
						onclick={() => select_session(session.session_id)}
						title={`${session.session_id}\n${session.cwd}\nLast event: ${time(session.last_ts)}`}
					>
						<span class="title-line">
							{#if is_active_session(session)}
								<i aria-label="Active session"></i>
							{/if}
							<strong>{label(session)}</strong>
						</span>
						<span>
							{session.pool || "default"} · {number_crunch(
								session.event_count,
							)} events · {time(session.last_ts)}
						</span>
						<small>{session.cwd}</small>
					</button>
				{/each}
			</details>
		{/each}
	</div>
</aside>

<style>
	.sidebar {
		position: sticky;
		top: 76px;
		max-height: calc(100vh - 76px);
		border-right: 1px solid var(--border-muted);
		background: color-mix(in srgb, var(--bg), var(--surface) 42%);
		display: flex;
		flex-direction: column;
	}
	.sticky {
		z-index: 2;
		padding: 14px;
		border-radius: 0;
		border-width: 0 0 1px;
		flex: 0 0 auto;
	}
	.stats {
		display: grid;
		grid-template-columns: auto 1fr auto 1fr auto 1fr;
		gap: 8px;
		margin-top: 12px;
		color: var(--muted);
	}
	.stats strong {
		color: var(--text);
	}
	.session-list {
		min-height: 0;
		padding: 12px;
		overflow-y: auto;
		flex: 1 1 auto;
	}
	.session-list > * + * {
		margin-top: 12px;
	}
	.project-group {
		background: transparent;
	}
	.project-group summary {
		list-style: none;
		cursor: pointer;
		padding: 0 2px 8px;
		display: flex;
		justify-content: space-between;
		gap: 12px;
		color: var(--muted);
		font-size: var(--font-size-compact);
	}
	.project-group summary::-webkit-details-marker {
		display: none;
	}
	.project-group summary strong {
		color: var(--text);
	}
	.session {
		width: 100%;
		text-align: left;
		justify-content: flex-start;
		display: grid;
		gap: 5px;
		margin-bottom: 8px;
		padding: 10px;
		border-color: transparent;
		background: transparent;
		color: var(--muted);
		min-height: 0;
	}
	.session:hover,
	.session.active {
		background: var(--surface);
		border-color: var(--border);
		color: var(--text);
	}
	.session.active {
		box-shadow: inset 3px 0 0 var(--accent);
	}
	.session span,
	.session small {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.session small {
		font-size: var(--font-size-compact);
	}
	.title-line {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--text);
	}
	.title-line i {
		width: 8px;
		height: 8px;
		border-radius: 99px;
		background: #76f7a0;
		box-shadow: 0 0 12px #76f7a0;
		flex: 0 0 auto;
	}
	@media (max-width: 900px) {
		.sidebar {
			position: static;
			max-height: none;
			border-right: 0;
			border-bottom: 1px solid var(--border-muted);
		}
		.session-list {
			display: flex;
			overflow-x: auto;
			padding: 10px;
		}
		.project-group {
			min-width: 280px;
		}
	}
</style>
