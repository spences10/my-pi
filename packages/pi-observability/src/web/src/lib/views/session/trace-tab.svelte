<script lang="ts">
	import type { DashboardEvent } from '#lib/api.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Collapsible from '#lib/components/ui/collapsible/index.js';
	import { Toggle } from '#lib/components/ui/toggle/index.js';
	import { clock, duration, tool_label } from '#lib/format.js';
	import { slide_open } from '#lib/motion.js';
	import {
		bar_position,
		contains_failure,
		failed_spans,
		find_span,
		run_of,
		trace_rows,
	} from '#lib/trace.js';
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import BotIcon from '@lucide/svelte/icons/bot';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import RepeatIcon from '@lucide/svelte/icons/repeat';
	import WrenchIcon from '@lucide/svelte/icons/wrench';
	import { tick, untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import type {
		SessionTimeline,
		TimelineSpan,
	} from '../../../../../types';
	import SpanSheet from './span-sheet.svelte';

	let {
		timeline,
		events,
		selected_id = null,
		on_select,
	}: {
		timeline: SessionTimeline;
		events: DashboardEvent[];
		/** The selected span, owned by the URL (?span=). */
		selected_id?: string | null;
		on_select: (span_id: string | null) => void;
	} = $props();

	let failures_only = $state(false);
	// Runs the reader opened or closed; others use default_open.
	const run_overrides = new SvelteMap<string, boolean>();
	// The span the page opened on, e.g. from the failures list. Its row
	// scrolls into view once, when it first renders.
	const arrival_id = untrack(() => selected_id);

	const runs = $derived(timeline.runs);
	const failures = $derived(failed_spans(runs));
	const selected = $derived(
		selected_id ? find_span(runs, selected_id) : null,
	);
	const selected_run_id = $derived(
		selected_id ? (run_of(runs, selected_id)?.id ?? null) : null,
	);
	const visible_runs = $derived(
		failures_only ? runs.filter(contains_failure) : runs,
	);

	// Open the runs worth reading first: all when there are few, else
	// the latest run, runs with failures, and the selected span's run.
	function is_open(run: TimelineSpan, index: number): boolean {
		return (
			run_overrides.get(run.id) ??
			(runs.length <= 3 ||
				index === runs.length - 1 ||
				run.id === selected_run_id ||
				contains_failure(run))
		);
	}

	function scroll_to(span_id: string): void {
		document
			.getElementById(row_dom_id(span_id))
			?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	}

	async function next_failure(): Promise<void> {
		if (failures.length === 0) return;
		const current = failures.findIndex(
			(span) => span.id === selected_id,
		);
		const next = failures[(current + 1) % failures.length]!;
		const run = run_of(runs, next.id);
		if (run) run_overrides.set(run.id, true);
		on_select(next.id);
		await tick();
		scroll_to(next.id);
	}

	/** Scrolls the arrival span's row into view when it mounts. */
	function scroll_if_arrival(span_id: string) {
		return (node: HTMLElement) => {
			if (span_id === arrival_id)
				node.scrollIntoView({ block: 'center' });
		};
	}

	function row_dom_id(span_id: string): string {
		return `span-${span_id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
	}

	function failure_count(span: TimelineSpan): number {
		return failed_spans([span]).length;
	}

	function label(span: TimelineSpan): string {
		return span.kind === 'tool' ? tool_label(span.name) : span.name;
	}

	const bar_classes = {
		run: 'bg-muted-foreground/25',
		turn: 'bg-muted-foreground/20',
		model: 'bg-chart-1',
		tool: 'bg-chart-2',
	} as const;

	const ticks = [0, 25, 50, 75, 100];
</script>

<div class="grid gap-3 px-4 pb-4">
	<div class="flex flex-wrap items-center gap-2">
		<p class="text-sm text-muted-foreground">
			{runs.length}
			{runs.length === 1 ? 'prompt' : 'prompts'} ·
			<span
				class={failures.length > 0
					? 'font-medium text-destructive'
					: ''}
			>
				{failures.length}
				{failures.length === 1 ? 'failure' : 'failures'}
			</span>
		</p>
		<div class="ml-auto flex flex-wrap items-center gap-1">
			<span
				class="mr-2 hidden items-center gap-3 text-xs text-muted-foreground sm:flex"
			>
				<span class="flex items-center gap-1.5"
					><span class="size-2.5 rounded-sm bg-chart-1"
					></span>Model</span
				>
				<span class="flex items-center gap-1.5"
					><span class="size-2.5 rounded-sm bg-chart-2"
					></span>Tool</span
				>
				<span class="flex items-center gap-1.5"
					><CircleAlertIcon
						class="size-3.5 text-destructive"
					/>Failed</span
				>
			</span>
			<Toggle
				size="sm"
				bind:pressed={failures_only}
				disabled={failures.length === 0}
			>
				Failures only
			</Toggle>
			<Button
				variant="outline"
				size="sm"
				disabled={failures.length === 0}
				onclick={next_failure}
			>
				<ArrowDownIcon />Next failure
			</Button>
		</div>
	</div>

	{#each visible_runs as run (run.id)}
		{@const open = is_open(run, runs.indexOf(run))}
		{@const run_failures = failure_count(run)}
		<Collapsible.Root
			class="rounded-xl border"
			{open}
			onOpenChange={(value) => run_overrides.set(run.id, value)}
		>
			<Collapsible.Trigger
				class="group flex w-full items-center gap-2 px-3 py-2.5 text-left"
			>
				<ChevronRightIcon
					class="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90"
				/>
				<span class="min-w-0 flex-1 truncate text-sm font-medium"
					>{run.name}</span
				>
				{#if run_failures > 0}
					<Badge variant="destructive">{run_failures} failed</Badge>
				{/if}
				{#if run.open}
					<Badge variant="outline">no end event</Badge>
				{/if}
				<span
					class="shrink-0 text-xs text-muted-foreground tabular-nums"
				>
					{clock(run.start_ts)} · {duration(run.duration_ms)}
				</span>
			</Collapsible.Trigger>

			<Collapsible.Content forceMount>
				{#snippet child({ props, open: content_open })}
					{#if content_open}
						<div {...props} class="border-t" transition:slide_open>
							<div
								class="grid grid-cols-[minmax(10rem,18rem)_minmax(0,1fr)] border-b text-[11px] text-muted-foreground"
								aria-hidden="true"
							>
								<span></span>
								<div class="relative h-6">
									{#each ticks as tick_value (tick_value)}
										<span
											class={[
												'absolute top-1 tabular-nums',
												tick_value === 0
													? ''
													: tick_value === 100
														? '-translate-x-full'
														: '-translate-x-1/2',
											]}
											style:left="{tick_value}%"
										>
											{tick_value === 0
												? '0'
												: duration(
														((run.end_ms - run.start_ms) *
															tick_value) /
															100,
													)}
										</span>
									{/each}
								</div>
							</div>
							<ul>
								{#each trace_rows(run, failures_only) as { span, depth } (span.id)}
									{@const position = bar_position(span, run)}
									<li
										id={row_dom_id(span.id)}
										{@attach scroll_if_arrival(span.id)}
										transition:slide_open
									>
										<button
											type="button"
											class={[
												'grid w-full grid-cols-[minmax(10rem,18rem)_minmax(0,1fr)] items-center text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none',
												selected_id === span.id && 'bg-muted',
											]}
											aria-label="{span.kind} {label(
												span,
											)}, {duration(span.duration_ms)}{span.error
												? ', failed'
												: ''}"
											onclick={() => on_select(span.id)}
										>
											<span
												class="flex min-w-0 items-center gap-1.5 py-1 pr-2 text-xs"
												style:padding-left="{0.75 + depth * 0.9}rem"
											>
												{#if span.error}
													<CircleAlertIcon
														class="size-3.5 shrink-0 text-destructive"
													/>
												{:else if span.kind === 'model'}
													<BotIcon
														class="size-3.5 shrink-0 text-muted-foreground"
													/>
												{:else if span.kind === 'tool'}
													<WrenchIcon
														class="size-3.5 shrink-0 text-muted-foreground"
													/>
												{:else}
													<RepeatIcon
														class="size-3.5 shrink-0 text-muted-foreground"
													/>
												{/if}
												<span
													class={[
														span.detail && span.kind === 'tool'
															? 'max-w-[60%] shrink-0 truncate'
															: 'truncate',
														span.kind === 'turn' && 'font-medium',
														span.kind === 'tool' && 'font-mono',
														span.error && 'text-destructive',
													]}
												>
													{label(span)}
												</span>
												{#if span.detail && span.kind === 'tool'}
													<span
														class="truncate font-mono text-muted-foreground"
														>{span.detail}</span
													>
												{/if}
											</span>
											<span class="relative h-7 border-l">
												<span
													class={[
														'absolute top-1.5 h-4 min-w-0.5 rounded-sm',
														bar_classes[span.kind],
														span.error &&
															'ring-2 ring-destructive ring-offset-1 ring-offset-background',
														span.open && 'opacity-60',
													]}
													style:left="{position.left}%"
													style:width="{position.width}%"
												></span>
												<!-- Duration sits after the bar; before it when the bar
											ends near the right edge; inside it when the bar fills the
											row. -->
												{#if position.left + position.width > 88 && position.left <= 12}
													<span
														class="absolute top-1.5 rounded-sm bg-background/80 px-1 text-[11px] leading-4 text-foreground tabular-nums"
														style:right="calc({100 -
															position.left -
															position.width}% + 0.25rem)"
													>
														{duration(span.duration_ms)}
													</span>
												{:else if position.left + position.width > 88}
													<span
														class="absolute top-1.5 text-[11px] leading-4 text-muted-foreground tabular-nums"
														style:right="calc({100 - position.left}% +
														0.375rem)"
													>
														{duration(span.duration_ms)}
													</span>
												{:else}
													<span
														class="absolute top-1.5 text-[11px] leading-4 text-muted-foreground tabular-nums"
														style:left="calc({position.left +
															position.width}% + 0.375rem)"
													>
														{duration(span.duration_ms)}
													</span>
												{/if}
											</span>
										</button>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				{/snippet}
			</Collapsible.Content>
		</Collapsible.Root>
	{:else}
		<p class="py-8 text-center text-sm text-muted-foreground">
			{failures_only
				? 'No failures in this session.'
				: 'No prompts recorded yet.'}
		</p>
	{/each}
</div>

<SpanSheet
	span={selected}
	{events}
	bind:open={
		() => selected !== null, (open) => !open && on_select(null)
	}
/>
