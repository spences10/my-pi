<script lang="ts">
	import type { DashboardSession } from "../../types";
	import {
		is_active_session,
		label,
		number_crunch,
		repo_name,
		select_session,
		state,
		time,
		toggle_query_token,
		toggle_archive,
		toggle_pin,
	} from "./dashboard-state.svelte";
	type Group = { name: string; sessions: DashboardSession[] };
	let { groups }: { groups: Group[] } = $props();
	const active_count = $derived(
		state.sessions.filter((session) => is_active_session(session)).length,
	);
	const selected_repo_token = $derived.by(() => {
		const session = state.sessions.find(
			(item) => item.session_id === state.selected_id,
		);
		return session ? `repo:${repo_name(session)}` : "";
	});
	const query_parts = $derived(state.query.split(/\s+/).filter(Boolean));
</script>

<aside class="sidebar">
	<div class="panel sticky">
		<input
			bind:value={state.query}
			placeholder="Search or use repo:, pool:, model:, active:true…"
		/>
		<div class="controls">
			<label>
				Group
				<select bind:value={state.group_by}>
					<option value="repo">Repo</option>
					<option value="pool">Pool</option>
					<option value="model">Model</option>
				</select>
			</label>
			<label>
				Sort
				<select bind:value={state.sort_by}>
					<option value="recent">Recent</option>
					<option value="events">Events</option>
					<option value="repo">Repo</option>
				</select>
			</label>
		</div>
		<div class="quick-filters" aria-label="Session quick filters">
			<button
				class:active={query_parts.includes("active:true")}
				onclick={() => toggle_query_token("active:true")}>Active</button
			>
			<button
				class:active={query_parts.includes("pinned:true")}
				onclick={() => toggle_query_token("pinned:true")}>Pinned</button
			>
			<button
				class:active={selected_repo_token &&
					query_parts.includes(selected_repo_token)}
				onclick={() => {
					if (selected_repo_token) toggle_query_token(selected_repo_token);
				}}>Current repo</button
			>
			<button
				class:active={state.show_archived}
				onclick={() => (state.show_archived = !state.show_archived)}
				>{state.show_archived ? "Hide archived" : "Show archived"}</button
			>
		</div>
		<div class="stats">
			<strong>{number_crunch(state.sessions.length)}</strong><span
				>sessions</span
			>
			<strong>{number_crunch(active_count)}</strong><span>active</span>
			<strong>
				{number_crunch(
					state.sessions.reduce(
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
					<div
						class:archived={state.archived[session.session_id]}
						class="session-row"
					>
						<button
							class:active={session.session_id === state.selected_id}
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
							{#if state.labels[session.session_id]?.length}
								<small class="chips">
									{state.labels[session.session_id].join(" · ")}
								</small>
							{/if}
						</button>
						<div class="session-actions">
							<button
								aria-label="Pin session"
								class:pinned={state.pinned[session.session_id]}
								onclick={() => toggle_pin(session.session_id)}
								>{state.pinned[session.session_id] ? "★" : "☆"}</button
							>
							<button
								aria-label="Archive session"
								onclick={() => toggle_archive(session.session_id)}
								>{state.archived[session.session_id] ? "↩" : "×"}</button
							>
						</div>
					</div>
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
		background: color-mix(in srgb, var(--bg), var(--surface) 35%);
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
	.controls {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		margin-top: 10px;
	}
	.controls label {
		display: grid;
		gap: 4px;
		color: var(--muted);
		font-size: var(--font-size-label);
		text-transform: uppercase;
	}
	.controls select {
		width: 100%;
	}
	.quick-filters {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 10px;
	}
	.quick-filters button,
	.session-actions button {
		min-height: 0;
		padding: 5px 8px;
		font-size: var(--font-size-compact);
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
	.session-row {
		position: relative;
		border-top: 1px solid var(--border-muted);
	}
	.session-row.archived {
		opacity: 0.58;
	}
	.session {
		width: 100%;
		min-width: 0;
		text-align: left;
		display: grid;
		gap: 5px;
		border: 0;
		border-radius: 0;
		background: transparent;
		transition: padding-right 120ms ease;
	}
	.session-row:hover .session,
	.session-row:focus-within .session {
		padding-right: 62px;
	}
	.session.active {
		background: color-mix(in srgb, var(--focus), transparent 78%);
	}
	.title-line {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.title-line i {
		width: 8px;
		height: 8px;
		border-radius: 999px;
		background: #31f59f;
		box-shadow: 0 0 12px #31f59f;
		flex: 0 0 auto;
	}
	.session-actions {
		position: absolute;
		top: 9px;
		right: 9px;
		display: flex;
		gap: 5px;
		opacity: 0;
		pointer-events: none;
		transition: opacity 120ms ease;
	}
	.session-row:hover .session-actions,
	.session-row:focus-within .session-actions,
	.session-actions:has(.pinned) {
		opacity: 1;
		pointer-events: auto;
	}
	.session-actions .pinned {
		color: var(--selected);
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
		.sidebar {
			position: static;
			max-height: none;
		}
		.session-list {
			overflow-y: visible;
		}
		.stats {
			grid-template-columns: auto 1fr auto 1fr;
		}
	}
</style>
