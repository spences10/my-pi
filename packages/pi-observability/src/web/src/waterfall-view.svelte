<script lang="ts">
	import type { TraceSpanSummary } from "../../types";
	import { duration, number_crunch, state } from "./dashboard-state.svelte";

	let {
		max_span,
		provider_spans,
		tool_spans,
	}: {
		max_span: number;
		provider_spans: TraceSpanSummary[];
		tool_spans: TraceSpanSummary[];
	} = $props();
</script>

<section class="insight-grid trace-layout">
	<div class="trace-main">
		<div class="panel span-panel">
			<div class="panel-head">
				<h3>Waterfall bottlenecks</h3>
				<span>{number_crunch(state.trace?.spans.length ?? 0)} spans</span>
			</div>
			{#each state.trace?.spans ?? [] as span (span.id)}<div
					class:error={span.error}
					class="span-row"
				>
					<div class="span-label">
						<strong>{span.name}</strong><span
							>{span.kind} · {number_crunch(span.event_count)} events</span
						>
					</div>
					<div class="bar">
						<i
							style:width={`${Math.max(4, (span.duration_ms / max_span) * 100)}%`}
						></i>
					</div>
					<time>{duration(span.duration_ms)}</time>
				</div>{/each}
		</div>
	</div>
	<div class="insight-stack">
		<div class="panel">
			<div class="panel-head">
				<h3>Tool duration</h3>
				<span>{number_crunch(tool_spans.length)}</span>
			</div>
			{#each tool_spans as span (span.id)}<div class="compact-row">
					<strong>{span.name}</strong><span>{duration(span.duration_ms)}</span>
				</div>{:else}<p class="empty compact">No tool spans.</p>{/each}
		</div>
		<div class="panel">
			<div class="panel-head">
				<h3>Provider calls</h3>
				<span>{number_crunch(provider_spans.length)}</span>
			</div>
			{#each provider_spans as span (span.id)}<div class="compact-row">
					<strong>{span.name}</strong><span>{duration(span.duration_ms)}</span>
				</div>{:else}<p class="empty compact">No provider spans.</p>{/each}
		</div>
	</div>
</section>

<style>
	.insight-grid {
		display: grid;
		grid-template-columns: minmax(420px, 1.2fr) minmax(320px, 0.8fr);
		gap: 18px;
	}
	.trace-layout {
		align-items: start;
		grid-template-columns: minmax(520px, 1.35fr) minmax(300px, 0.65fr);
	}
	.trace-main,
	.insight-stack {
		display: grid;
		gap: 14px;
		min-width: 0;
	}
	.insight-stack .panel {
		min-width: 0;
		overflow: hidden;
	}
	.span-panel {
		overflow: hidden;
	}
	.span-row {
		display: grid;
		grid-template-columns: 220px minmax(160px, 1fr) 80px;
		gap: 12px;
		align-items: center;
		padding: 12px 16px;
		border-bottom: 1px solid
			color-mix(in srgb, var(--border-muted), transparent 55%);
	}
	.span-row.error {
		background: color-mix(in srgb, var(--red), transparent 80%);
	}
	.span-label {
		display: grid;
		gap: 4px;
		min-width: 0;
	}
	.span-label strong,
	.span-label span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.span-label span {
		color: var(--muted);
		font-size: var(--font-size-compact);
	}
	.bar {
		height: 13px;
		border-radius: 999px;
		background: var(--bg);
		overflow: hidden;
	}
	.bar i {
		display: block;
		height: 100%;
		border-radius: 999px;
		background: linear-gradient(
			90deg,
			var(--selected),
			var(--focus),
			var(--yellow)
		);
	}
	time {
		color: var(--muted);
	}
	@media (max-width: 1200px) {
		.insight-grid {
			display: block;
		}
		.span-row {
			grid-template-columns: 1fr;
		}
	}
</style>
