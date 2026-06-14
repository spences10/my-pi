<script lang="ts">
	import { dashboard_state, toggle_theme } from "./dashboard-state.svelte";
</script>

<header>
	<div>
		<h1>Pi Observability</h1>
	</div>
	<div class="toolbar">
		<span class:live={dashboard_state.connected} class="status">
			{dashboard_state.connected ? "live" : "reconnecting"}
		</span>
		<button onclick={toggle_theme}>
			{dashboard_state.theme === "dark" ? "Light" : "Dark"}
		</button>
		<button onclick={() => (dashboard_state.paused = !dashboard_state.paused)}>
			{dashboard_state.paused ? "Resume" : "Pause"}
		</button>
	</div>
</header>
