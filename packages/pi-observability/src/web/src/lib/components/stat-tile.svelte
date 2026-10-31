<script lang="ts">
	import * as Card from '#lib/components/ui/card/index.js';
	import type { Snippet } from 'svelte';

	let {
		label,
		value,
		detail,
		tone = 'default',
		icon,
	}: {
		label: string;
		value: string;
		detail?: string;
		tone?: 'default' | 'destructive';
		icon?: Snippet;
	} = $props();
</script>

<Card.Root class="gap-1 py-4">
	<Card.Header class="px-4">
		<Card.Description class="flex items-center gap-1.5 text-xs">
			{@render icon?.()}
			{label}
		</Card.Description>
	</Card.Header>
	<Card.Content class="px-4">
		<p
			class={[
				'text-2xl font-semibold tracking-tight font-stretch-112%',
			]}
		>
			{value}
		</p>
		{#if detail}
			<p
				class={[
					'mt-0.5 truncate text-xs',
					tone === 'destructive'
						? 'font-medium text-destructive'
						: 'text-muted-foreground',
				]}
			>
				{detail}
			</p>
		{/if}
	</Card.Content>
</Card.Root>
