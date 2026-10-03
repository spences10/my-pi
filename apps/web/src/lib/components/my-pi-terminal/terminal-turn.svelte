<script lang="ts">
	import CodeBlock from './code-block.svelte';
	import CollapseHint from './collapse-hint.svelte';
	import type { RenderedTurn } from './types';

	let { turn }: { turn: RenderedTurn } = $props();
</script>

{#if turn.role === 'user'}
	<div class="user-turn">
		<span class="user-chev">›</span>
		<span class="user-text">{turn.text}</span>
	</div>
{:else if turn.role === 'assistant'}
	<div class="assistant-turn">{turn.text}</div>
{:else if turn.role === 'read' || turn.role === 'write'}
	<div class="file-turn">
		<div class="file-head">
			<span class="file-verb">{turn.role}</span>
			<span class="file-path">{turn.path}</span
			>{#if turn.role === 'read' && turn.range}<span
					class="file-colon">:</span
				><span class="file-range">{turn.range}</span>{/if}
		</div>
		{#if turn.lines_above != null && turn.lines_above > 0}
			<div class="collapse-wrap">
				<CollapseHint more={turn.lines_above} />
			</div>
		{/if}
		<CodeBlock code={turn.code} />
		{#if turn.lines_below != null && turn.lines_below > 0}
			<div class="collapse-wrap">
				<CollapseHint
					more={turn.lines_below}
					total={turn.total_lines}
				/>
			</div>
		{/if}
	</div>
{:else if turn.role === 'bash'}
	<div class="bash-turn">
		<div class="bash-head">
			<span class="file-verb">bash</span>
			<span class="bash-dollar">$</span>
			<span class="bash-cmd">{turn.command}</span>
		</div>
		{#if turn.output}
			<pre class="bash-output">{turn.output}</pre>
		{/if}
		{#if (turn.exit_code ?? 0) !== 0}
			<div class="bash-exit">exit {turn.exit_code}</div>
		{/if}
	</div>
{:else if turn.role === 'diff'}
	<div class="diff-turn">
		<div class="file-head">
			<span class="file-verb">edit</span>
			<span class="file-path">{turn.path}</span>
		</div>
		<div class="diff-body">
			{#each turn.hunks as hunk, hi (hi)}
				<div class="hunk" class:last={hi === turn.hunks.length - 1}>
					{#if hunk.line_number != null}
						<div class="hunk-head">@@ line {hunk.line_number} @@</div>
					{/if}
					{#each hunk.before ?? [] as ln, li (`b-${li}`)}
						<div class="diff-line removed">
							<span class="sign">-</span><span>{ln || '\u00a0'}</span>
						</div>
					{/each}
					{#each hunk.after ?? [] as ln, li (`a-${li}`)}
						<div class="diff-line added">
							<span class="sign">+</span><span>{ln || '\u00a0'}</span>
						</div>
					{/each}
				</div>
			{/each}
		</div>
	</div>
{/if}
