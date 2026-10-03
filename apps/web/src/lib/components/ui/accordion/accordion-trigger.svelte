<script lang="ts">
	import { cn } from '#lib/utils.js';
	import { Accordion as AccordionPrimitive } from 'bits-ui';
	import { CaretDownIcon } from 'phosphor-svelte';
	import type { ComponentProps } from 'svelte';

	let {
		ref = $bindable(null),
		class: class_name,
		children,
		...rest_props
	}: ComponentProps<typeof AccordionPrimitive.Trigger> = $props();
</script>

<AccordionPrimitive.Header class="flex">
	<AccordionPrimitive.Trigger
		bind:ref
		class={cn(
			'group flex flex-1 items-center justify-between py-5 text-left font-mono text-base font-bold text-foreground transition hover:text-accent [&[data-state=open]>svg]:rotate-180',
			class_name,
		)}
		{...rest_props}
	>
		{@render children?.()}
		<CaretDownIcon
			class="size-4 shrink-0 text-cyan transition-transform duration-200"
		/>
	</AccordionPrimitive.Trigger>
</AccordionPrimitive.Header>
