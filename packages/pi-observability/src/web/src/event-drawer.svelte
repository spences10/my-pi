<script lang="ts">
	import { state, time } from "./dashboard-state.svelte";

	type Token = { id: string; text: string; class_name?: string };

	function close_drawer() {
		state.selected_event = null;
	}

	function handle_keydown(event: KeyboardEvent) {
		if (state.selected_event && event.key === "Escape") close_drawer();
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

{#if state.selected_event}
	<button
		aria-label="Close event details"
		class="drawer-backdrop"
		onclick={close_drawer}
	></button>
	<aside aria-label="Event details" class="drawer">
		<button class="close" onclick={close_drawer}>Close</button>
		<h3>{state.selected_event.type} #{state.selected_event.seq}</h3>
		<p>{time(state.selected_event.ts)}</p>
		<pre class="json"><code
				>{#each json_tokens(state.selected_event.payload) as token (token.id)}<span
						class={token.class_name}>{token.text}</span
					>{/each}</code
			></pre>
	</aside>
{/if}
