<script lang="ts">
	import type { DashboardSession } from "../../types";
	import { label, select_session, state } from "./dashboard-state.svelte";
	type Group = { name: string; sessions: DashboardSession[] };
	let { groups }: { groups: Group[] } = $props();
</script>

<aside class="sidebar">
	<div class="panel sticky">
		<input
			bind:value={state.query}
			placeholder="Filter sessions, pools, models, labels…"
		/>
		<div class="stats">
			<strong>{state.sessions.length}</strong><span>sessions</span>
			<strong>
				{state.sessions.reduce(
					(sum, session) => sum + Number(session.event_count || 0),
					0,
				)}
			</strong><span>events</span>
		</div>
	</div>
	<div class="session-list">
		{#each groups as group (group.name)}
			<details class="project-group" open>
				<summary>
					<strong>{group.name}</strong><span>
						{group.sessions.length} sessions
					</span>
				</summary>
				{#each group.sessions as session (session.session_id)}
					<button
						class:active={session.session_id === state.selected_id}
						class="session"
						onclick={() => select_session(session.session_id)}
					>
						<strong>{label(session)}</strong>
						<span>
							{session.pool || "default"} · {session.event_count} events
						</span>
						<small>{session.cwd}</small>
						{#if state.labels[session.session_id]?.length}
							<small class="chips">
								{state.labels[session.session_id].join(" · ")}
							</small>
						{/if}
					</button>
				{/each}
			</details>
		{/each}
	</div>
</aside>

<style>
	.sidebar {
		border-right: 1px solid var(--border-muted);
		background: color-mix(in srgb, var(--bg), var(--surface) 35%);
	}
	.sticky {
		position: sticky;
		top: 76px;
		z-index: 2;
		padding: 14px;
		border-radius: 0;
		border-width: 0 0 1px;
	}
	.stats {
		display: grid;
		grid-template-columns: auto 1fr auto 1fr;
		gap: 8px;
		margin-top: 12px;
		color: var(--muted);
	}
	.stats strong {
		color: var(--text);
	}
	.session-list {
		padding: 12px;
		display: grid;
		gap: 12px;
	}
	.project-group {
		border: 1px solid var(--border-muted);
		border-radius: 16px;
		overflow: hidden;
		background: color-mix(in srgb, var(--surface), transparent 35%);
	}
	.project-group summary {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 12px;
		cursor: pointer;
	}
	.project-group summary span,
	.session span,
	.session small {
		color: var(--muted);
	}
	.session {
		width: 100%;
		text-align: left;
		display: grid;
		gap: 5px;
		border-width: 1px 0 0;
		border-radius: 0;
		background: transparent;
	}
	.session.active {
		background: color-mix(in srgb, var(--focus), transparent 78%);
	}
	.session strong,
	.session span,
	.session small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.chips {
		color: var(--selected) !important;
	}
	@media (max-width: 1200px) {
		.sidebar {
			border-right: 0;
		}
	}
	@media (max-width: 720px) {
		.sticky {
			top: 0;
		}
	}
</style>
