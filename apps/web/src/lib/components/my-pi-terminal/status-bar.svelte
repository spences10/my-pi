<script lang="ts">
	import { format_k } from './syntax';
	import type { Metrics } from './types';

	let {
		cwd,
		branch,
		provider,
		model,
		effort,
		prompt_mode,
		metrics,
	}: {
		cwd: string;
		branch: string;
		provider: string;
		model: string;
		effort: string;
		prompt_mode: string;
		metrics: Metrics;
	} = $props();
</script>

<div class="status-bar">
	<div class="status-left">
		<div>
			{cwd} <span class="git-branch">(↯ {branch} ?1 ↟1)</span>
		</div>
		<div class="metrics">
			<span>↑{format_k(metrics.up)}</span>
			<span>↓{format_k(metrics.down)}</span>
			<span>R{format_k(metrics.ram)}</span>
			<span>${metrics.cost.toFixed(3)}</span>
			<span>(sub)</span>
			<span
				>{((metrics.ctx_used / metrics.ctx_max) * 100).toFixed(
					1,
				)}%/{format_k(metrics.ctx_max)}</span
			>
		</div>
		<div class="mcp-status">MCP 5/5 connected</div>
	</div>
	<div class="status-right">
		<div class="session-name">my-pi-terminal-layout</div>
		<div>
			{model} <span class="sep">·</span>
			<span>{effort}</span>
		</div>
		<div class="prompt-mode">prompt:{prompt_mode} +1</div>
	</div>
</div>
