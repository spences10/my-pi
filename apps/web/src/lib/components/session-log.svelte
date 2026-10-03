<script lang="ts">
	import type { Turn } from './session-log/types.js';

	let {
		title = 'session.log',
		note,
		conversation,
	}: {
		title?: string;
		note?: string;
		conversation: Turn[];
	} = $props();
</script>

<div class="log">
	<header>
		<span>{title}</span>
		{#if note}<span>{note}</span>{/if}
	</header>

	<ol>
		{#each conversation as turn (turn)}
			<li class={turn.role}>
				{#if turn.role === 'user'}
					<p><span aria-hidden="true">&gt;</span> {turn.text}</p>
				{:else if turn.role === 'assistant' || turn.role === 'working'}
					<p>{turn.text}</p>
				{:else if turn.role === 'read'}
					<figure>
						<figcaption>
							read <b>{turn.path}</b
							>{#if turn.range}:{turn.range}{/if}
						</figcaption>
						<pre><code>{turn.code}</code></pre>
						{#if turn.lines_below}
							<small>… {turn.lines_below} more lines</small>
						{/if}
					</figure>
				{:else if turn.role === 'diff'}
					<figure>
						<figcaption>edit <b>{turn.path}</b></figcaption>
						<pre><code
								>{#each turn.hunks as hunk (hunk)}{#each hunk.before ?? [] as line, index (index)}<del
											>- {line}{'\n'}</del
										>{/each}{#each hunk.after ?? [] as line, index (index)}<ins
											>+ {line}{'\n'}</ins
										>{/each}{/each}</code
							></pre>
					</figure>
				{:else if turn.role === 'bash'}
					<figure>
						<figcaption>
							<span aria-hidden="true">$</span> <b>{turn.command}</b>
							{#if turn.exit_code !== undefined}
								<i class:failed={turn.exit_code !== 0}
									>exit {turn.exit_code}</i
								>
							{/if}
						</figcaption>
						{#if turn.output}
							<pre><code>{turn.output}</code></pre>
						{/if}
					</figure>
				{/if}
			</li>
		{/each}
	</ol>
</div>

<style>
	.log {
		--line: color-mix(
			in srgb,
			var(--afterglow-border-variant) 76%,
			transparent
		);

		border: 1px solid var(--line);
		background: var(--afterglow-elevated-surface-background);
		font-family: var(--font-mono);
		font-size: 0.86rem;
		line-height: 1.6;
	}

	header {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		justify-content: space-between;
		padding: 0.7rem clamp(1rem, 3vw, 1.75rem);
		border-bottom: 1px solid var(--line);
		color: var(--afterglow-text-muted);
		font-size: 0.72rem;
	}

	header span:first-child {
		color: var(--afterglow-terminal-magenta);
		font-weight: 700;
	}

	ol {
		display: grid;
		gap: 1.1rem;
		margin: 0;
		padding: clamp(1rem, 3vw, 1.75rem);
		list-style: none;
	}

	li {
		min-width: 0;
	}

	p,
	figure {
		margin: 0;
	}

	.user p {
		padding: 0.7rem 0.9rem;
		border-left: 0.5rem solid var(--afterglow-terminal-magenta);
		background: color-mix(
			in srgb,
			var(--afterglow-terminal-magenta) 10%,
			transparent
		);
		font-weight: 650;
	}

	.user span {
		color: var(--afterglow-terminal-magenta);
	}

	.working p {
		color: var(--afterglow-text-muted);
		font-style: italic;
	}

	.assistant p {
		max-width: 76ch;
		color: color-mix(in srgb, var(--afterglow-text) 86%, transparent);
	}

	figcaption {
		display: flex;
		flex-wrap: wrap;
		gap: 0 0.5rem;
		align-items: baseline;
		color: var(--afterglow-terminal-cyan);
		font-size: 0.78rem;
		overflow-wrap: anywhere;
	}

	figcaption b {
		color: var(--afterglow-text);
		font-weight: 650;
	}

	figcaption span {
		color: var(--afterglow-terminal-magenta);
		font-weight: 800;
	}

	figcaption i {
		margin-left: auto;
		color: var(--afterglow-terminal-green);
		font-style: normal;
	}

	figcaption i.failed {
		color: var(--afterglow-terminal-red);
	}

	pre {
		overflow-x: auto;
		margin: 0.5rem 0 0;
		padding: 0.8rem 0.9rem;
		border-left: 0.5rem solid var(--afterglow-border-variant);
		background: var(--afterglow-background);
		color: var(--afterglow-text-muted);
		font-family: inherit;
		font-size: 0.78rem;
		line-height: 1.55;
	}

	.bash pre {
		border-left-color: var(--afterglow-terminal-green);
	}

	ins,
	del {
		display: block;
		text-decoration: none;
	}

	ins {
		color: var(--afterglow-terminal-green);
	}

	del {
		color: var(--afterglow-terminal-red);
	}

	small {
		display: block;
		margin-top: 0.35rem;
		color: var(--afterglow-comment);
		font-size: 0.72rem;
	}
</style>
