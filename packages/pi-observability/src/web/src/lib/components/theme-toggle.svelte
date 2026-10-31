<script lang="ts">
	import { buttonVariants } from '#lib/components/ui/button/button.svelte';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import { theme, type ThemeMode } from '#lib/theme.svelte.js';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import SunIcon from '@lucide/svelte/icons/sun';

	const options: { value: ThemeMode; label: string }[] = [
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' },
		{ value: 'system', label: 'System' },
	];
</script>

<DropdownMenu.Root>
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props: tooltip_props })}
				<DropdownMenu.Trigger
					{...tooltip_props}
					class={buttonVariants({ variant: 'ghost', size: 'icon' })}
					aria-label="Change theme"
				>
					{#if theme.dark}
						<SunIcon strokeWidth={1.5} aria-hidden="true" />
					{:else}
						<MoonIcon strokeWidth={1.5} aria-hidden="true" />
					{/if}
				</DropdownMenu.Trigger>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content>Theme</Tooltip.Content>
	</Tooltip.Root>
	<DropdownMenu.Content align="end" class="w-32">
		<DropdownMenu.RadioGroup
			value={theme.mode}
			onValueChange={(value) => theme.set(value as ThemeMode)}
		>
			{#each options as option (option.value)}
				<DropdownMenu.RadioItem value={option.value}>
					{option.label}
				</DropdownMenu.RadioItem>
			{/each}
		</DropdownMenu.RadioGroup>
	</DropdownMenu.Content>
</DropdownMenu.Root>
