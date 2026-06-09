<script lang="ts">
	import { add_label, remove_label, state } from "./dashboard-state.svelte";
</script>

<section class="labels panel">
	<input
		bind:value={state.label_input}
		onkeydown={(event) => {
			if (event.key === "Enter") add_label();
		}}
		placeholder="Add labels or review notes…"
	/>
	<button onclick={add_label}>Save note</button>
	{#each state.labels[state.selected_id] || [] as item, index (item + index)}
		<button class="label-chip" onclick={() => remove_label(index)}>
			{item} ×
		</button>
	{/each}
</section>
