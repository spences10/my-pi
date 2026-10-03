<script lang="ts">
	import { slide } from 'svelte/transition';
	import type { RenderedTurn } from './session-log/types.js';

	let {
		title = 'session.log',
		note,
		conversation,
	}: {
		title?: string;
		note?: string;
		conversation: RenderedTurn[];
	} = $props();

	// All steps show at first. Step mode starts again from the prompt.
	let shown = $state<number>();
	const count = $derived(shown ?? conversation.length);
	const stepping = $derived(count < conversation.length);
</script>

<div class="log">
	<header>
		<span>{title}</span>
		{#if note}<span>{note}</span>{/if}
		<div class="controls">
			{#if stepping}
				<button type="button" onclick={() => (shown = count + 1)}>
					Next step {count}/{conversation.length}
				</button>
				<button type="button" onclick={() => (shown = undefined)}>
					Show all
				</button>
			{:else}
				<button type="button" onclick={() => (shown = 1)}>
					Step through
				</button>
			{/if}
		</div>
	</header>

	<ol aria-live="polite">
		{#each conversation.slice(0, count) as turn (turn)}
			<li class={turn.role} in:slide={{ duration: 260 }}>
				{#if turn.role === 'read'}
					<figure>
						<figcaption>
							read <b>{turn.path}</b
							>{#if turn.range}:{turn.range}{/if}
						</figcaption>
						{@html turn.html}
						{#if turn.lines_below}
							<small>… {turn.lines_below} more lines</small>
						{/if}
					</figure>
				{:else if turn.role === 'diff'}
					<figure>
						<figcaption>edit <b>{turn.path}</b></figcaption>
						{@html turn.html}
					</figure>
				{:else if turn.role === 'bash'}
					<figure>
						<figcaption>
							<span aria-hidden="true">$</span>
							{@html turn.command_html}
							{#if turn.exit_code !== undefined}
								<i class:failed={turn.exit_code !== 0}
									>exit {turn.exit_code}</i
								>
							{/if}
						</figcaption>
						{#if turn.output}
							<pre class="output">{turn.output}</pre>
						{/if}
					</figure>
				{:else if turn.role === 'user'}
					<p><span aria-hidden="true">&gt;</span> {turn.text}</p>
				{:else}
					<p>{turn.text}</p>
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
		gap: 0.4rem 1rem;
		align-items: center;
		padding: 0.6rem clamp(1rem, 3vw, 1.75rem);
		border-bottom: 1px solid var(--line);
		color: var(--afterglow-text-muted);
		font-size: 0.72rem;
	}

	header > span:first-child {
		color: var(--afterglow-terminal-magenta);
		font-weight: 700;
	}

	.controls {
		display: flex;
		gap: 0.5rem;
		margin-left: auto;
	}

	button {
		padding: 0.3rem 0.65rem;
		border: 1px solid var(--afterglow-border-variant);
		background: transparent;
		color: var(--afterglow-terminal-cyan);
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}

	button:hover {
		border-color: var(--afterglow-terminal-magenta);
		color: var(--afterglow-terminal-magenta);
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

	figcaption > span {
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

	small {
		display: block;
		margin-top: 0.35rem;
		color: var(--afterglow-comment);
		font-size: 0.72rem;
	}

	/* Twinkleplop output, in the afterglow palette. */
	.log :global(pre) {
		overflow-x: auto;
		margin: 0.5rem 0 0;
		padding-block: 0.8rem;
		border-left: 0.5rem solid var(--afterglow-border-variant);
		background: var(--afterglow-background);
		color: var(--afterglow-text);
		font-family: inherit;
		font-size: 0.78rem;
		line-height: 1.55;
		tab-size: 2;
	}

	.log :global(pre.output) {
		padding-inline: 0.9rem;
		border-left-color: var(--afterglow-terminal-green);
		color: var(--afterglow-text-muted);
	}

	.log :global(pre code) {
		display: grid;
		width: max-content;
		min-width: 100%;
		font: inherit;
	}

	.log :global(.l) {
		min-height: 1lh;
		padding-inline: 0.9rem;
	}

	.log :global(.l.highlight) {
		background: color-mix(
			in srgb,
			var(--afterglow-terminal-yellow) 14%,
			transparent
		);
		box-shadow: inset 3px 0 0 var(--afterglow-terminal-yellow);
	}

	.log :global(.l[data-highlighted-line-id='added']) {
		background: color-mix(
			in srgb,
			var(--afterglow-terminal-green) 11%,
			transparent
		);
		box-shadow: inset 3px 0 0 var(--afterglow-terminal-green);
	}

	.log :global(.l[data-highlighted-line-id='removed']) {
		background: color-mix(
			in srgb,
			var(--afterglow-terminal-red) 14%,
			transparent
		);
		box-shadow: inset 3px 0 0 var(--afterglow-terminal-red);
		opacity: 0.75;
	}

	.log :global(.l[data-highlighted-line-id='added'])::before,
	.log :global(.l[data-highlighted-line-id='removed'])::before {
		display: inline-block;
		width: 2ch;
		color: var(--afterglow-terminal-green);
		content: '+';
	}

	.log :global(.l[data-highlighted-line-id='removed'])::before {
		color: var(--afterglow-terminal-red);
		content: '-';
	}

	.log :global(.comment) {
		color: var(--afterglow-comment);
		font-style: italic;
	}

	.log :global(:is(.punctuation, .operator)) {
		color: var(--afterglow-text-muted);
	}

	.log :global(.keyword) {
		color: var(--afterglow-terminal-magenta);
	}

	.log :global(:is(.string, .template, .regex)) {
		color: var(--afterglow-terminal-green);
	}

	.log :global(:is(.type, .class_name, .builtin, .namespace)) {
		color: var(--afterglow-terminal-yellow);
	}

	.log :global(:is(.function, .property)) {
		color: var(--afterglow-terminal-cyan);
	}

	.log :global(:is(.number, .boolean, .null, .constant)) {
		color: var(--afterglow-border);
	}

	/* The command in a caption: inline, no block frame. */
	.log figcaption :global(pre) {
		overflow: visible;
		margin: 0;
		padding: 0;
		border: 0;
		background: none;
		font-size: inherit;
		font-weight: 650;
		white-space: pre-wrap;
	}

	.log figcaption :global(pre code) {
		display: inline;
	}

	.log figcaption :global(.l) {
		padding: 0;
	}
</style>
