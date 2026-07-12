<script lang="ts">
	import type { TraceSpanSummary } from "../../types";
	import {
		dashboard_state,
		duration,
		number_crunch,
	} from "./dashboard-state.svelte";

	type ToolSummary = {
		name: string;
		calls: number;
		errors: number;
		total_duration_ms: number;
		avg_duration_ms: number;
		max_duration_ms: number;
	};

	let {
		max_span,
		provider_spans,
		tool_spans,
		tools = [],
	}: {
		max_span: number;
		provider_spans: TraceSpanSummary[];
		tool_spans: TraceSpanSummary[];
		tools?: ToolSummary[];
	} = $props();

	const max_tool_total = $derived(
		Math.max(1, ...tools.map((tool) => tool.total_duration_ms)),
	);
	const total_failures = $derived(
		tools.reduce((sum, tool) => sum + tool.errors, 0),
	);

	function failure_rate(tool: ToolSummary) {
		if (!tool.calls) return "0%";
		return `${Math.round((tool.errors / tool.calls) * 100)}%`;
	}
</script>

<section class="performance-layout">
	<div class="performance-main">
		<section class="tool-health">
			<div class="section-head">
				<div>
					<p class="eyebrow">Aggregate outcomes</p>
					<h3>Tool health</h3>
				</div>
				<p>
					{number_crunch(tools.reduce((sum, tool) => sum + tool.calls, 0))} calls
					·
					<span class:bad={total_failures > 0}
						>{number_crunch(total_failures)} failed</span
					>
				</p>
			</div>
			{#if tools.length}
				<div
					class="tool-table"
					role="table"
					aria-label="Tool performance summary"
				>
					<div class="tool-row tool-columns" role="row">
						<span role="columnheader">Tool / total time</span>
						<span role="columnheader">Calls</span>
						<span role="columnheader">Failures</span>
						<span role="columnheader">Average</span>
						<span role="columnheader">Slowest</span>
					</div>
					{#each tools as tool (tool.name)}
						<div class:failed={tool.errors > 0} class="tool-row" role="row">
							<div class="tool-name" role="cell">
								<span
									><strong>{tool.name}</strong><code
										>{duration(tool.total_duration_ms)}</code
									></span
								>
								<i
									><b
										style:width={`${Math.max(2, (tool.total_duration_ms / max_tool_total) * 100)}%`}
									></b></i
								>
							</div>
							<div role="cell"><code>{number_crunch(tool.calls)}</code></div>
							<div class:error-value={tool.errors > 0} role="cell">
								<code
									>{number_crunch(tool.errors)}
									<small>{failure_rate(tool)}</small></code
								>
							</div>
							<div role="cell">
								<code>{duration(tool.avg_duration_ms)}</code>
							</div>
							<div role="cell">
								<code>{duration(tool.max_duration_ms)}</code>
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<div class="empty performance-empty">
					<strong>Per-tool summaries are not available for this trace.</strong>
					<span>Individual completed spans are listed below.</span>
				</div>
			{/if}
		</section>

		<section class="span-panel">
			<div class="section-head">
				<div>
					<p class="eyebrow">Critical path</p>
					<h3>Slow operations</h3>
				</div>
				<p>
					{number_crunch(dashboard_state.trace?.spans.length ?? 0)} completed spans
				</p>
			</div>
			<div class="span-columns" aria-hidden="true">
				<span>Operation</span><span>Relative duration</span><span>Time</span>
			</div>
			{#each dashboard_state.trace?.spans ?? [] as span (span.id)}
				<div class:error={span.error} class="span-row">
					<div class="span-label">
						<strong>{span.name}</strong>
						<span>{span.kind} · {number_crunch(span.event_count)} events</span>
					</div>
					<div class="bar">
						<i
							style:width={`${Math.max(2, (span.duration_ms / max_span) * 100)}%`}
						></i>
					</div>
					<time>{duration(span.duration_ms)}</time>
				</div>
			{:else}
				<p class="empty">No completed spans in this trace.</p>
			{/each}
		</section>
	</div>

	<aside class="performance-rail">
		<section>
			<div class="rail-head">
				<div>
					<p class="eyebrow">Slowest calls</p>
					<h3>Tool spans</h3>
				</div>
				<strong>{number_crunch(tool_spans.length)}</strong>
			</div>
			{#each tool_spans as span (span.id)}
				<div class:error={span.error} class="compact-row">
					<span
						><strong>{span.name}</strong><small
							>{number_crunch(span.event_count)} events</small
						></span
					>
					<code>{duration(span.duration_ms)}</code>
				</div>
			{:else}<p class="empty compact">No completed tool spans.</p>{/each}
		</section>
		<section>
			<div class="rail-head">
				<div>
					<p class="eyebrow">Model latency</p>
					<h3>Provider spans</h3>
				</div>
				<strong>{number_crunch(provider_spans.length)}</strong>
			</div>
			{#each provider_spans as span (span.id)}
				<div class:error={span.error} class="compact-row">
					<span
						><strong>{span.name}</strong><small
							>{number_crunch(span.event_count)} events</small
						></span
					>
					<code>{duration(span.duration_ms)}</code>
				</div>
			{:else}<p class="empty compact">No completed provider spans.</p>{/each}
		</section>
	</aside>
</section>

<style>
	.performance-layout {
		display: grid;
		grid-template-columns: minmax(620px, 1fr) minmax(270px, 0.3fr);
		gap: 18px;
		align-items: start;
	}
	.performance-main,
	.performance-rail {
		display: grid;
		gap: 14px;
		min-width: 0;
	}
	.tool-health,
	.span-panel,
	.performance-rail section {
		min-width: 0;
		overflow: hidden;
		border: 1px solid var(--border-muted);
		background: color-mix(in srgb, var(--surface), transparent 7%);
	}
	.section-head,
	.rail-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		padding: 11px 13px;
		border-bottom: 1px solid var(--border-muted);
	}
	.section-head h3,
	.rail-head h3 {
		font-size: 14px;
	}
	.section-head > p {
		color: var(--muted);
		font-family: var(--font-mono);
		font-size: var(--font-size-compact);
	}
	.bad,
	.error-value {
		color: var(--red);
	}
	.tool-row {
		display: grid;
		grid-template-columns: minmax(220px, 1fr) repeat(4, minmax(72px, 0.3fr));
		gap: 12px;
		align-items: center;
		min-height: 47px;
		padding: 7px 12px;
		border-bottom: 1px solid
			color-mix(in srgb, var(--border-muted), transparent 45%);
	}
	.tool-row.failed {
		box-shadow: inset 2px 0 0 var(--red);
	}
	.tool-row > div > code {
		font-size: var(--font-size-compact);
	}
	.tool-row small {
		color: var(--muted);
		font-size: var(--font-size-label);
	}
	.tool-columns {
		min-height: 28px;
		color: var(--muted);
		font-size: var(--font-size-label);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.tool-name {
		display: grid;
		gap: 6px;
		min-width: 0;
	}
	.tool-name > span {
		display: flex;
		justify-content: space-between;
		gap: 10px;
	}
	.tool-name strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tool-name code {
		color: var(--muted);
		font-size: var(--font-size-label);
	}
	.tool-name i {
		height: 2px;
		background: var(--bg);
	}
	.tool-name b {
		display: block;
		height: 100%;
		background: var(--selected);
	}
	.performance-empty {
		display: grid;
		gap: 4px;
	}
	.performance-empty strong {
		color: var(--text);
	}
	.span-columns,
	.span-row {
		display: grid;
		grid-template-columns: minmax(180px, 0.6fr) minmax(180px, 1fr) 72px;
		gap: 14px;
		align-items: center;
	}
	.span-columns {
		padding: 7px 12px;
		border-bottom: 1px solid var(--border-muted);
		color: var(--muted);
		font-size: var(--font-size-label);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.span-row {
		min-height: 45px;
		padding: 7px 12px;
		border-bottom: 1px solid
			color-mix(in srgb, var(--border-muted), transparent 45%);
	}
	.span-row.error,
	.compact-row.error {
		background: color-mix(in srgb, var(--red), transparent 91%);
		box-shadow: inset 2px 0 0 var(--red);
	}
	.span-label {
		display: grid;
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
		font-size: var(--font-size-label);
	}
	.bar {
		height: 4px;
		background: var(--bg);
		overflow: hidden;
	}
	.bar i {
		display: block;
		height: 100%;
		background: linear-gradient(90deg, var(--selected), var(--focus));
	}
	time {
		color: var(--muted);
		font-family: var(--font-mono);
		font-size: var(--font-size-compact);
	}
	.rail-head > strong {
		font: 700 18px/1 var(--font-mono);
	}
	.compact-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 10px;
		padding: 9px 11px;
		border-bottom: 1px solid
			color-mix(in srgb, var(--border-muted), transparent 45%);
	}
	.compact-row > span {
		display: grid;
		min-width: 0;
	}
	.compact-row strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--font-size-compact);
	}
	.compact-row small {
		color: var(--muted);
		font-size: var(--font-size-label);
	}
	.compact-row code {
		color: var(--muted);
		font-size: var(--font-size-compact);
	}
	@media (max-width: 1220px) {
		.performance-layout {
			grid-template-columns: 1fr;
		}
		.performance-rail {
			grid-template-columns: 1fr 1fr;
		}
	}
	@media (max-width: 760px) {
		.tool-row {
			grid-template-columns: minmax(150px, 1fr) repeat(2, minmax(62px, auto));
		}
		.tool-row > :nth-child(4),
		.tool-row > :nth-child(5) {
			display: none;
		}
		.span-columns {
			display: none;
		}
		.span-row {
			grid-template-columns: minmax(150px, 1fr) 72px;
		}
		.span-row .bar {
			grid-row: 2;
			grid-column: 1 / -1;
		}
		.performance-rail {
			grid-template-columns: 1fr;
		}
	}
</style>
