<script lang="ts">
	import { cn } from '#lib/utils.js';
	import { Accordion as AccordionPrimitive } from 'bits-ui';
	import type { ComponentProps } from 'svelte';

	let {
		ref = $bindable(null),
		class: class_name,
		children,
		...rest_props
	}: ComponentProps<typeof AccordionPrimitive.Root> = $props();
</script>

<AccordionPrimitive.Root
	bind:ref
	class={cn('w-full', class_name)}
	{...rest_props}
>
	{@render children?.()}
</AccordionPrimitive.Root>
