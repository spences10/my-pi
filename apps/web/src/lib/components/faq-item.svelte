<script lang="ts">
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';

	let { question, answer }: { question: string; answer: string } =
		$props();

	// Before hydration this is a plain <details>. After it, the answer
	// slides, and <details> stays open until the slide out is complete.
	let hydrated = $state(false);
	let open = $state(false);
	let expanded = $state(false);

	onMount(() => {
		hydrated = true;
	});

	function toggle(event: MouseEvent) {
		event.preventDefault();
		if (expanded) {
			expanded = false;
		} else {
			open = true;
			expanded = true;
		}
	}
</script>

<details {open} class="group border-b border-rule">
	<summary
		class="flex cursor-pointer list-none items-center justify-between gap-4 py-[1.2rem] text-[0.9rem] font-bold [&::-webkit-details-marker]:hidden"
		onclick={toggle}
	>
		{question}<i
			class="text-[1.1rem] text-magenta not-italic transition-[rotate] duration-180 ease-[ease] group-open:rotate-45"
			aria-hidden="true">+</i
		>
	</summary>
	{#if !hydrated || expanded}
		<p
			class="max-w-[66ch] pb-6 font-sans text-[0.92rem] leading-[1.7] text-pretty text-copy"
			transition:slide={{ duration: 220 }}
			onoutroend={() => (open = false)}
		>
			{answer}
		</p>
	{/if}
</details>
