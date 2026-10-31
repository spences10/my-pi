<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import { live } from '#lib/live.svelte.js';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PlayIcon from '@lucide/svelte/icons/play';

	const label = $derived(
		!live.connected ? 'Offline' : live.paused ? 'Paused' : 'Live',
	);
</script>

<div class="flex items-center gap-1">
	<span
		class="inline-flex items-center gap-1.5 rounded-full border px-1.5 py-1 text-xs font-medium sm:px-2 sm:py-0.5"
		role="status"
	>
		<span class="relative flex size-2">
			{#if live.connected && !live.paused}
				<span
					class="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:animate-none"
				></span>
			{/if}
			<span
				class={[
					'relative inline-flex size-2 rounded-full',
					!live.connected
						? 'bg-destructive'
						: live.paused
							? 'bg-warning'
							: 'bg-success',
				]}
			></span>
		</span>
		<span class="sr-only sm:not-sr-only">{label}</span>
	</span>
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="ghost"
					size="icon"
					aria-label={live.paused
						? 'Resume updates'
						: 'Pause updates'}
					onclick={() => live.toggle_paused()}
				>
					{#if live.paused}<PlayIcon />{:else}<PauseIcon />{/if}
				</Button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content>
			{live.paused ? 'Resume live updates' : 'Pause live updates'}
		</Tooltip.Content>
	</Tooltip.Root>
</div>
