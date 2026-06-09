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
