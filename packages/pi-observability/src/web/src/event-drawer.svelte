<script lang="ts">
	import { dashboard_state, time } from "./dashboard-state.svelte";

	type Token = { id: string; text: string; class_name?: string };

	function close_drawer() {
		dashboard_state.selected_event = null;
	}

	function handle_keydown(event: KeyboardEvent) {
		if (dashboard_state.selected_event && event.key === "Escape")
			close_drawer();
	}

	function json_tokens(value: unknown) {
		const source = JSON.stringify(value, null, 2);
		const pattern =
			/("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"\s*:)|("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g;
		const tokens: Token[] = [];
		let cursor = 0;
		for (const match of source.matchAll(pattern)) {
			const index = match.index ?? 0;
			if (index > cursor)
				tokens.push({
					id: `plain:${cursor}`,
					text: source.slice(cursor, index),
				});
			tokens.push({
				id: `token:${index}`,
				text: match[0],
				class_name: match[1]
					? "json-key"
					: match[2]
						? "json-string"
						: match[3]
							? "json-literal"
							: "json-number",
			});
			cursor = index + match[0].length;
		}
		if (cursor < source.length)
			tokens.push({ id: `plain:${cursor}`, text: source.slice(cursor) });
		return tokens;
	}
</script>

<svelte:window onkeydown={handle_keydown} />

{#if dashboard_state.selected_event}
	<button
		aria-label="Close event details"
		class="drawer-backdrop"
		onclick={close_drawer}
	></button>
	<aside aria-label="Event details" class="drawer">
		<button class="close" onclick={close_drawer}>Close</button>
		<h3>
			{dashboard_state.selected_event.type} #{dashboard_state.selected_event
				.seq}
		</h3>
		<p>{time(dashboard_state.selected_event.ts)}</p>
		<pre class="json"><code
				>{#each json_tokens(dashboard_state.selected_event.payload) as token (token.id)}<span
						class={token.class_name}>{token.text}</span
					>{/each}</code
			></pre>
	</aside>
{/if}

<style>
	.drawer-backdrop {
		position: fixed;
		inset: 0;
		border: 0;
		border-radius: 0;
		background: color-mix(in srgb, var(--bg), transparent 34%);
		z-index: 5;
	}
	.drawer {
		position: fixed;
		right: 0;
		top: 0;
		bottom: 0;
		width: min(620px, 92vw);
		padding: 20px;
		background: var(--bg);
		border-left: 1px solid var(--border);
		box-shadow: -30px 0 80px var(--shadow);
		z-index: 6;
		font-size: var(--font-size-ui);
		overflow: auto;
	}
	.drawer h3 {
		font-size: var(--font-size-ui);
		line-height: 1.35;
	}
	.drawer p {
		font-size: var(--font-size-compact);
		color: var(--muted);
	}
	.close {
		float: right;
	}
	pre {
		font-family: var(--font-mono);
		font-size: var(--font-size-ui);
		line-height: 1.45;
		white-space: pre-wrap;
		background: var(--surface);
		border: 1px solid var(--border-muted);
		border-radius: 14px;
		padding: 14px;
		color: var(--text);
	}
	.json,
	.json code {
		font-family: var(--font-mono);
		font-size: var(--font-size-ui);
		line-height: 1.45;
		overflow-wrap: anywhere;
	}
	.json-key {
		color: var(--cyan);
	}
	.json-string {
		color: var(--green);
	}
	.json-number {
		color: var(--yellow);
	}
	.json-literal {
		color: var(--focus);
	}
</style>
