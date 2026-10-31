<script lang="ts">
	import type { DashboardEvent } from '#lib/api.js';
	import CodeBlock from '#lib/components/code-block.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
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
	<Sheet.Content
		class="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[min(56rem,70vw)]"
	>
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
			<div class="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
				<CodeBlock code={json} language="json" label="Payload" />
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>
