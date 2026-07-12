<script lang="ts">
	import { dashboard_state, toggle_theme } from "./dashboard-state.svelte";
</script>

<header class="topbar">
	<div class="brand" aria-label="Pi Observability">
		<strong>π</strong>
		<span>Observability</span>
	</div>
	<div class="toolbar">
		<span class:live={dashboard_state.connected} class="status">
			<i></i>{dashboard_state.connected ? "Live" : "Reconnecting"}
		</span>
		<button
			class:active={dashboard_state.paused}
			onclick={() => (dashboard_state.paused = !dashboard_state.paused)}
		>
			{dashboard_state.paused ? "Resume stream" : "Pause stream"}
		</button>
		<button aria-label="Toggle color theme" onclick={toggle_theme}>
			{dashboard_state.theme === "dark" ? "Light mode" : "Dark mode"}
		</button>
	</div>
</header>

<style>
	.topbar {
		height: var(--topbar-height);
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 18px;
		border-bottom: 1px solid var(--border-muted);
		background: color-mix(in srgb, var(--bg), transparent 5%);
		backdrop-filter: blur(16px);
		position: sticky;
		top: 0;
		z-index: 5;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		font-family: var(--font-mono);
		letter-spacing: -0.02em;
	}
	.brand strong {
		display: grid;
		place-items: center;
		width: 27px;
		height: 27px;
		border: 1px solid var(--border);
		color: var(--focus);
		font-size: 18px;
		line-height: 1;
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.toolbar button {
		min-height: 30px;
		padding: 5px 9px;
		border-color: transparent;
		background: transparent;
		color: var(--muted);
		font-size: var(--font-size-compact);
	}
	.toolbar button:hover,
	.toolbar button.active {
		border-color: var(--border-muted);
		color: var(--text);
	}
	.status {
		display: flex;
		align-items: center;
		gap: 7px;
		margin-right: 4px;
		color: var(--yellow);
		font: var(--font-size-label) / 1 var(--font-mono);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.status i {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
		box-shadow: 0 0 8px currentColor;
	}
	.status.live {
		color: var(--green);
	}
	@media (max-width: 620px) {
		.topbar {
			height: auto;
			min-height: var(--topbar-height);
			align-items: flex-start;
			gap: 10px;
			padding-block: 10px;
		}
		.toolbar {
			justify-content: flex-end;
			flex-wrap: wrap;
		}
		.toolbar button {
			padding-inline: 5px;
		}
	}
</style>
