<script lang="ts">
	import { state, toggle_theme } from "./dashboard-state.svelte";
</script>

<header>
	<div>
		<p class="eyebrow">Neon Afterglow telemetry</p>
		<h1>Pi Observability</h1>
	</div>
	<div class="toolbar">
		<span class:live={state.connected} class="status">
			{state.connected ? "live" : "reconnecting"}
		</span>
		<button onclick={toggle_theme}>
			{state.theme === "dark" ? "Light" : "Dark"}
		</button>
		<button onclick={() => (state.paused = !state.paused)}>
			{state.paused ? "Resume" : "Pause"}
		</button>
	</div>
</header>
