<script lang="ts">
	import * as Select from '#lib/components/ui/select/index.js';
	import { range, RANGES, type RangeKey } from '#lib/range.svelte.js';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
</script>

<Select.Root
	type="single"
	value={range.key}
	onValueChange={(value) => range.set(value as RangeKey)}
>
	<Select.Trigger class="w-auto sm:w-44" aria-label="Time range">
		<CalendarIcon class="hidden text-muted-foreground sm:block" />
		{range.label}
	</Select.Trigger>
	<Select.Content align="end">
		{#each RANGES as option (option.key)}
			<Select.Item value={option.key} label={option.label} />
		{/each}
	</Select.Content>
</Select.Root>
