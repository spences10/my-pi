<script lang="ts">
	import { CheckIcon, CopyIcon } from 'phosphor-svelte';

	let { command, echo = false }: { command: string; echo?: boolean } =
		$props();

	let copied = $state(false);
	let reset_timer: ReturnType<typeof setTimeout> | undefined;

	async function copy_command() {
		try {
			await navigator.clipboard.writeText(command);
		} catch {
			return;
		}
		copied = true;
		clearTimeout(reset_timer);
		reset_timer = setTimeout(() => (copied = false), 1600);
	}
</script>

<div class="command" class:echo class:copied>
	<span aria-hidden="true">$</span>
	<code>{command}</code>
	<button
		type="button"
		aria-label={copied ? 'Copied' : `Copy command: ${command}`}
		onclick={copy_command}
	>
		{#if copied}
			<CheckIcon aria-hidden="true" />
		{:else}
			<CopyIcon aria-hidden="true" />
		{/if}
	</button>
	<span class="sr-only" role="status">{copied ? 'Copied' : ''}</span>
</div>

<style>
	.command {
		display: flex;
		align-items: center;
		width: fit-content;
		max-width: 100%;
		border: 1px solid var(--afterglow-border);
		background: var(--afterglow-background);
		font-family: var(--font-mono);
		transition:
			box-shadow 120ms ease,
			translate 120ms ease;
	}

	/* On copy, the block moves onto its outlines: a pressed 8-bit button. */
	.command.echo.copied {
		--echo-step: 0px;

		translate: 6px 6px;
	}

	.command.copied {
		border-color: var(--afterglow-terminal-green);
	}

	.command > span:first-child {
		padding: 0.9rem 0 0.9rem 1rem;
		color: var(--afterglow-terminal-magenta);
		font-weight: 800;
	}

	code {
		overflow-x: auto;
		padding: 0.9rem 0.75rem;
		color: var(--afterglow-terminal-green);
		font-size: clamp(0.8rem, 1.5vw, 0.95rem);
		font-weight: 700;
		white-space: nowrap;
	}

	button {
		display: grid;
		place-items: center;
		align-self: stretch;
		padding-inline: 0.8rem;
		border: 0;
		border-left: 1px solid var(--afterglow-border-variant);
		background: transparent;
		color: var(--afterglow-text-muted);
		cursor: pointer;
	}

	button:hover {
		color: var(--afterglow-terminal-magenta);
	}

	.copied button {
		color: var(--afterglow-terminal-green);
	}
</style>
