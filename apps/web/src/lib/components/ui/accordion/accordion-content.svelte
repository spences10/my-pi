<script lang="ts">
	import { cn } from '#lib/utils.js';
	import { Accordion as AccordionPrimitive } from 'bits-ui';
	import type { ComponentProps } from 'svelte';
	import { slide } from 'svelte/transition';

	let {
		ref = $bindable(null),
		class: class_name,
		children,
		...rest_props
	}: ComponentProps<typeof AccordionPrimitive.Content> = $props();
</script>

<AccordionPrimitive.Content bind:ref forceMount {...rest_props}>
	{#snippet child({ props, open })}
		<div
			{...props}
			class={cn('overflow-hidden leading-7 text-muted', class_name)}
		>
			{#if open}
				<div transition:slide={{ duration: 180 }} class="pb-5">
					{@render children?.()}
				</div>
			{/if}
		</div>
	{/snippet}
</AccordionPrimitive.Content>
