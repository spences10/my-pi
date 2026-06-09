<script lang="ts">
	import { state, time } from "./dashboard-state.svelte";
</script>

{#if state.selected_event}
	<aside class="drawer">
		<button class="close" onclick={() => (state.selected_event = null)}>
			Close
		</button>
		<h3>{state.selected_event.type} #{state.selected_event.seq}</h3>
		<p>{time(state.selected_event.ts)}</p>
		<pre>{JSON.stringify(state.selected_event.payload, null, 2)}</pre>
	</aside>
{/if}
