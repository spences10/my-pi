<script lang="ts">
	import { slide } from 'svelte/transition';

	let { question, answer }: { question: string; answer: string } =
		$props();

	// Before hydration this is a plain <details>. After it, the answer
	// slides, and <details> stays open until the slide out is complete.
	let hydrated = $state(false);
	let open = $state(false);
	let expanded = $state(false);

	$effect(() => {
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

<details {open}>
	<summary onclick={toggle}>
		{question}<i class:expanded aria-hidden="true">+</i>
	</summary>
	{#if !hydrated || expanded}
		<p
			transition:slide={{ duration: 220 }}
			onoutroend={() => (open = false)}
		>
			{answer}
		</p>
	{/if}
</details>

<style>
	details {
		border-bottom: 1px solid var(--line);
	}

	summary {
		display: flex;
		gap: 1rem;
		align-items: center;
		justify-content: space-between;
		padding: 1.2rem 0;
		font-size: 0.9rem;
		font-weight: 700;
		cursor: pointer;
		list-style: none;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	i {
		color: var(--afterglow-terminal-magenta);
		font-size: 1.1rem;
		font-style: normal;
		transition: rotate 180ms ease;
	}

	i.expanded,
	details[open]:not(:has(i.expanded)) i {
		rotate: 45deg;
	}

	p {
		max-width: 66ch;
		margin: 0;
		padding-bottom: 1.5rem;
		color: var(--copy);
		font-family: var(--font-sans);
		font-size: 0.92rem;
		line-height: 1.7;
		text-wrap: pretty;
	}
</style>
