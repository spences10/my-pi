<script lang="ts">
	import type { DashboardEvent } from '#lib/api.js';
	import CodeBlock from '#lib/components/code-block.svelte';
	import { slide_open } from '#lib/motion.js';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CopyButton from '#lib/components/copy-button.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Collapsible from '#lib/components/ui/collapsible/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import { type_label } from '#lib/events.js';
	import {
		clock,
		duration,
		money,
		number_crunch,
		tool_label,
	} from '#lib/format.js';
	import type { TimelineSpan } from '../../../../../types';

	let {
		span,
		events,
		open = $bindable(false),
	}: {
		span: TimelineSpan | null;
		events: DashboardEvent[];
		open?: boolean;
	} = $props();

	const kind_labels = {
		run: 'Prompt run',
		turn: 'Turn',
		model: 'Model call',
		tool: 'Tool call',
	} as const;

	const span_events = $derived(
		span
			? events
					.filter((event) => span.event_seqs.includes(event.seq))
					.toSorted((a, b) => a.seq - b.seq)
			: [],
	);

	// The timeline keeps a one-line preview; the tool_call event holds
	// the input as sent.
	const full_input = $derived.by(() => {
		const call = span_events.find(
			(event) => event.type === 'tool_call',
		);
		const input = call?.payload.input as
			| Record<string, unknown>
			| undefined;
		const value = [
			'command',
			'path',
			'file_path',
			'pattern',
			'query',
			'url',
		]
			.map((key) => input?.[key])
			.find((item): item is string => typeof item === 'string');
		return value ?? span?.detail ?? null;
	});

	const facts = $derived.by(() => {
		if (!span) return [];
		const items: [string, string][] = [
			['Started', clock(span.start_ts)],
			[
				'Duration',
				span.open
					? `${duration(span.duration_ms)}+`
					: duration(span.duration_ms),
			],
		];
		if (span.exit_code != null)
			items.push(['Exit code', String(span.exit_code)]);
		if (span.update_count != null)
			items.push(['Progress updates', String(span.update_count)]);
		if (span.input_tokens != null)
			items.push([
				'Tokens',
				`${number_crunch(span.input_tokens)} in · ${number_crunch(span.output_tokens ?? 0)} out · ${number_crunch(span.cache_read_tokens ?? 0)} cached`,
			]);
		if (span.cost_usd != null)
			items.push(['Cost', money(span.cost_usd)]);
		return items;
	});
</script>

<Sheet.Root bind:open>
	<Sheet.Content
		class="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[min(56rem,70vw)]"
	>
		{#if span}
			<Sheet.Header class="border-b">
				<Sheet.Description>{kind_labels[span.kind]}</Sheet.Description
				>
				<Sheet.Title class="flex flex-wrap items-center gap-2">
					<span class="break-all">
						{span.kind === 'tool' ? tool_label(span.name) : span.name}
					</span>
					{#if span.error}
						<Badge variant="destructive">Failed</Badge>
					{:else if span.open}
						<Badge variant="outline">No end event</Badge>
					{/if}
				</Sheet.Title>
				{#if span.detail && span.kind === 'model'}
					<p class="font-mono text-xs text-muted-foreground">
						stop reason: {span.detail}
					</p>
				{/if}
			</Sheet.Header>
			<div class="min-h-0 min-w-0 flex-1 overflow-y-auto">
				<div class="grid grid-cols-[minmax(0,1fr)] gap-5 p-4">
					{#if full_input && span.kind === 'tool'}
						<CodeBlock
							code={full_input}
							language={span.name === 'bash' ? 'bash' : 'text'}
							label="Input"
						/>
					{/if}

					<dl
						class="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm"
					>
						{#each facts as [label, value] (label)}
							<dt class="text-muted-foreground">{label}</dt>
							<dd class="tabular-nums">{value}</dd>
						{/each}
					</dl>

					{#if span.error_text}
						<section
							class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5"
						>
							<div class="flex items-center justify-between">
								<h3 class="text-sm font-medium text-destructive">
									Error output
								</h3>
								<CopyButton
									value={span.error_text}
									label="Copy error output"
								/>
							</div>
							<pre
								class="max-h-112 overflow-auto rounded-lg border border-destructive/30 bg-destructive/5 p-3 font-mono text-xs leading-relaxed wrap-break-word whitespace-pre-wrap">{span.error_text}</pre>
						</section>
					{:else if span.error}
						<p class="text-sm text-muted-foreground">
							No error output was recorded. Events from before failure
							capture was added only mark the call as failed.
						</p>
					{/if}

					{#if span_events.length > 0}
						<section
							class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2"
						>
							<h3 class="text-sm font-medium">Events</h3>
							{#each span_events as event (event.event_id)}
								<Collapsible.Root
									class="min-w-0 overflow-hidden rounded-lg border"
								>
									<Collapsible.Trigger
										class="group flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm hover:bg-muted/50"
									>
										<ChevronRightIcon
											class="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90"
										/>
										<span class="text-muted-foreground tabular-nums"
											>#{event.seq}</span
										>
										{type_label(event.type)}
										<span class="text-muted-foreground">
											· {clock(event.ts)}</span
										>
									</Collapsible.Trigger>
									<Collapsible.Content forceMount>
										{#snippet child({ props, open })}
											{#if open}
												<div {...props} transition:slide_open>
													<CodeBlock
														code={JSON.stringify(
															event.payload,
															null,
															2,
														)}
														language="json"
														class="rounded-none border-x-0 border-b-0"
													/>
												</div>
											{/if}
										{/snippet}
									</Collapsible.Content>
								</Collapsible.Root>
							{/each}
						</section>
					{/if}
				</div>
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>
