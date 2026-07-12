<script lang="ts">
	import {
		dashboard_state,
		payload_value,
		text_preview,
		time,
	} from "./dashboard-state.svelte";
	import { event_has_error } from "./event-analysis";

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
			["payload", is_summarized ? "summarized" : "detail"],
			["provider", event.provider || session?.provider || "—"],
			["model", event.model || session?.model || "—"],
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
		<header class="drawer-head">
			<div>
				<p class="eyebrow">Event inspector</p>
				<h3>{dashboard_state.selected_event.type.replaceAll("_", " ")}</h3>
			</div>
			<button
				aria-label="Close event inspector"
				class="close"
				onclick={close_drawer}>×</button
			>
		</header>

		<div
			class="event-identity"
			class:error={event_has_error(dashboard_state.selected_event)}
		>
			<div>
				<span>Sequence</span><strong
					>#{dashboard_state.selected_event.seq}</strong
				>
			</div>
			<div>
				<span>Timestamp</span><strong
					>{time(dashboard_state.selected_event.ts)}</strong
				>
			</div>
			{#each event_meta as [name, value] (name)}
				<div><span>{name}</span><strong>{value}</strong></div>
			{/each}
		</div>

		{#if important_fields.length}
			<section class="field-section">
				<h4>Outcome & context</h4>
				<dl>
					{#each important_fields as [name, value] (name)}
						<div>
							<dt>{name}</dt>
							<dd>{text_preview(value, 500)}</dd>
						</div>
					{/each}
				</dl>
			</section>
		{/if}

		<details class="technical-details">
			<summary>Identifiers & source</summary>
			<div>
				<span
					><b>Session</b><code>{dashboard_state.selected_event.session_id}</code
					></span
				>
				<span
					><b>Event id</b><code>{dashboard_state.selected_event.event_id}</code
					></span
				>
				<span
					><b>Session file</b><code
						>{dashboard_state.selected_event.session_file || "—"}</code
					></span
				>
			</div>
		</details>

		<section class="payload-section">
			<div class="payload-head">
				<h4>Payload</h4>
				<span>{is_summarized ? "Summary mode" : "Detail mode"}</span>
			</div>
			<pre class="json"><code
					>{#each json_tokens(dashboard_state.selected_event.payload) as token (token.id)}<span
							class={token.class_name}>{token.text}</span
						>{/each}</code
				></pre>
		</section>
	</aside>
{/if}

<style>
	.drawer {
		position: fixed;
		right: 0;
		top: 0;
		bottom: 0;
		width: min(760px, 94vw);
		background: var(--bg);
		border-left: 1px solid var(--border);
		box-shadow: -24px 0 80px var(--shadow);
		z-index: 8;
		overflow: auto;
	}
	.drawer-head {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		min-height: 66px;
		padding: 12px 16px;
		border-bottom: 1px solid var(--border-muted);
		background: color-mix(in srgb, var(--bg), transparent 4%);
		backdrop-filter: blur(16px);
	}
	.drawer-head h3 {
		font-size: 16px;
		text-transform: capitalize;
	}
	.close {
		width: 32px;
		height: 32px;
		padding: 0;
		border-color: transparent;
		background: transparent;
		color: var(--muted);
		font-size: 24px;
		line-height: 1;
	}
	.event-identity {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		border-bottom: 1px solid var(--border-muted);
	}
	.event-identity.error {
		box-shadow: inset 3px 0 0 var(--red);
	}
	.event-identity > div {
		display: grid;
		gap: 3px;
		padding: 11px 13px;
		border-right: 1px solid var(--border-muted);
		min-width: 0;
	}
	.event-identity > div:last-child {
		border-right: 0;
	}
	.event-identity span,
	.technical-details b {
		color: var(--muted);
		font-size: var(--font-size-label);
		text-transform: uppercase;
		letter-spacing: 0.07em;
	}
	.event-identity strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font: 700 var(--font-size-compact) / 1.3 var(--font-mono);
	}
	.field-section,
	.technical-details,
	.payload-section {
		margin: 0 16px;
	}
	.field-section {
		padding: 16px 0 12px;
		border-bottom: 1px solid var(--border-muted);
	}
	h4 {
		margin: 0;
		font-size: var(--font-size-compact);
		text-transform: uppercase;
		letter-spacing: 0.07em;
	}
	dl {
		margin: 9px 0 0;
	}
	dl > div {
		display: grid;
		grid-template-columns: 110px minmax(0, 1fr);
		gap: 12px;
		padding: 7px 0;
		border-top: 1px solid
			color-mix(in srgb, var(--border-muted), transparent 50%);
	}
	dt {
		color: var(--muted);
		font-size: var(--font-size-label);
		text-transform: uppercase;
		letter-spacing: 0.07em;
	}
	dd {
		margin: 0;
		overflow-wrap: anywhere;
		font-family: var(--font-mono);
		font-size: var(--font-size-compact);
	}
	.technical-details {
		padding: 12px 0;
		border-bottom: 1px solid var(--border-muted);
		color: var(--muted);
	}
	.technical-details summary {
		cursor: pointer;
		font-size: var(--font-size-compact);
	}
	.technical-details > div {
		display: grid;
		gap: 7px;
		margin-top: 9px;
	}
	.technical-details span {
		display: grid;
		grid-template-columns: 110px minmax(0, 1fr);
		gap: 12px;
		overflow-wrap: anywhere;
	}
	.payload-section {
		padding: 16px 0;
	}
	.payload-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 8px;
	}
	.payload-head span {
		color: var(--muted);
		font-size: var(--font-size-label);
		text-transform: uppercase;
		letter-spacing: 0.07em;
	}
	pre {
		margin: 0;
		padding: 13px;
		border: 1px solid var(--border-muted);
		background: var(--surface);
		color: var(--text);
		font-family: var(--font-mono);
		font-size: var(--font-size-compact);
		line-height: 1.55;
		white-space: pre-wrap;
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
	@media (max-width: 660px) {
		.event-identity {
			grid-template-columns: repeat(2, 1fr);
		}
		.event-identity > div {
			border-bottom: 1px solid var(--border-muted);
		}
		dl > div,
		.technical-details span {
			grid-template-columns: 1fr;
			gap: 3px;
		}
	}
</style>
