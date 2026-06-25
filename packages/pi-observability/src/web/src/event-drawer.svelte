<script lang="ts">
	import {
		dashboard_state,
		payload_value,
		text_preview,
		time,
	} from "./dashboard-state.svelte";

	type Token = { id: string; text: string; class_name?: string };

	function close_drawer() {
		dashboard_state.selected_event = null;
	}

	function handle_keydown(event: KeyboardEvent) {
		if (dashboard_state.selected_event && event.key === "Escape")
			close_drawer();
	}

	const important_fields = $derived.by(() => {
		const event = dashboard_state.selected_event;
		if (!event) return [];
		const payload = event.payload || {};
		return [
			["tool", payload.toolName || payload.tool_name],
			["model", payload.model || payload_value(payload, "payload.model")],
			["thinking", payload_value(payload, "payload.reasoning")],
			["status", payload.status],
			["error", payload.error || payload.isError],
		].filter(([, value]) => value !== undefined && value !== "");
	});

	const is_summarized = $derived.by(() => {
		const text = JSON.stringify(dashboard_state.selected_event?.payload || {});
		return text.includes('"keys"') || text.includes('"type":"object"');
	});

	const event_meta = $derived.by(() => {
		const event = dashboard_state.selected_event;
		const session = dashboard_state.trace?.session;
		if (!event) return [];
		return [
			["payload", is_summarized ? "summarized" : "raw/detail"],
			...(event.provider && event.provider !== session?.provider
				? [["provider", event.provider]]
				: []),
			...(event.model && event.model !== session?.model
				? [["model", event.model]]
				: []),
		];
	});

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
	<aside aria-label="Event details" class="drawer">
		<button class="close" onclick={close_drawer}>Close</button>
		<h3>
			{dashboard_state.selected_event.type} #{dashboard_state.selected_event
				.seq}
		</h3>
		<p>{time(dashboard_state.selected_event.ts)}</p>
		<div class="meta-strip">
			{#each event_meta as [name, value] (name)}
				<span><b>{name}</b> {value}</span>
			{/each}
		</div>
		<div class="details-row">
			<details class="technical-details">
				<summary>Technical details</summary>
				<div>
					<span
						><b>Session</b>
						<code>{dashboard_state.selected_event.session_id}</code></span
					>
					<span
						><b>Event id</b>
						<code>{dashboard_state.selected_event.event_id}</code></span
					>
					<span
						><b>Provider</b>
						{dashboard_state.selected_event.provider || "—"}</span
					>
					<span><b>Model</b> {dashboard_state.selected_event.model || "—"}</span
					>
				</div>
			</details>
		</div>
		{#if important_fields.length}
			<div class="field-list">
				{#each important_fields as [name, value] (name)}
					<div>
						<span>{name}</span>
						<p>{text_preview(value, 500)}</p>
					</div>
				{/each}
			</div>
		{/if}
		<pre class="json"><code
				>{#each json_tokens(dashboard_state.selected_event.payload) as token (token.id)}<span
						class={token.class_name}>{token.text}</span
					>{/each}</code
			></pre>
	</aside>
{/if}

<style>
	.drawer {
		position: fixed;
		right: 0;
		top: 0;
		bottom: 0;
		width: min(920px, 94vw);
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
	.meta-strip {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 18px;
		margin: 12px 0 6px;
	}
	.meta-strip b,
	.technical-details b,
	.field-list span {
		color: var(--muted);
		font-size: var(--font-size-label);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		margin-right: 5px;
	}
	.details-row {
		display: flex;
		flex-wrap: wrap;
		gap: 14px;
		margin: 0 0 12px;
	}
	.technical-details {
		color: var(--muted);
	}
	.technical-details summary {
		cursor: pointer;
		font-size: var(--font-size-compact);
	}
	.technical-details div {
		display: grid;
		gap: 6px;
		margin-top: 8px;
	}
	.technical-details span,
	.field-list p {
		overflow-wrap: anywhere;
	}
	.field-list {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		margin: 12px 0;
	}
	.field-list div {
		min-width: 0;
		background: var(--surface);
		border: 1px solid var(--border-muted);
		border-radius: 12px;
		padding: 10px;
	}
	.field-list span {
		display: block;
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
