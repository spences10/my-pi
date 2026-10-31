<script lang="ts">
	import type { DashboardEvent } from '#lib/api.js';
	import CodeBlock from '#lib/components/code-block.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { ScrollArea } from '#lib/components/ui/scroll-area/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import {
		event_has_error,
		event_summary,
		type_label,
	} from '#lib/events.js';

	let {
		event,
		open = $bindable(false),
	}: { event: DashboardEvent | null; open?: boolean } = $props();

	const json = $derived(
		event ? JSON.stringify(event.payload, null, 2) : '',
	);
	const summary = $derived(event ? event_summary(event) : '');
</script>

<Sheet.Root bind:open>
	<Sheet.Content class="w-full gap-0 sm:max-w-xl">
		{#if event}
			<Sheet.Header class="border-b">
				<Sheet.Title class="flex items-center gap-2">
					{type_label(event.type)}
					{#if event_has_error(event)}
						<Badge variant="destructive">Error</Badge>
					{/if}
				</Sheet.Title>
				<Sheet.Description class="font-mono text-xs">
					#{event.seq} · {new Date(event.ts).toLocaleString()}
				</Sheet.Description>
				{#if summary}
					<p class="text-sm break-words">{summary}</p>
				{/if}
			</Sheet.Header>
			<ScrollArea class="min-h-0 flex-1 p-4">
				<CodeBlock code={json} language="json" label="Payload" />
			</ScrollArea>
		{/if}
	</Sheet.Content>
</Sheet.Root>
