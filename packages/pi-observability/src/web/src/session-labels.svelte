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

<style>
	.labels {
		display: flex;
		flex: 0 0 auto;
		gap: 10px;
		align-items: center;
		padding: 12px;
		margin-bottom: 14px;
		flex-wrap: wrap;
	}
	.labels input {
		max-width: 430px;
	}
	.label-chip {
		border-color: var(--selected);
		color: var(--selected);
	}
</style>
