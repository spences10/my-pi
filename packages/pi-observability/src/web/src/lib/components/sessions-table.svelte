<script lang="ts">
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import {
		money,
		number_crunch,
		relative_time,
		repo_name,
		session_title,
	} from '#lib/format.js';
	import { live } from '#lib/live.svelte.js';
	import { session_href } from '#lib/router.js';
	import type { SessionStats } from '../../../../types';

	let {
		sessions,
		show_model = true,
	}: { sessions: SessionStats[]; show_model?: boolean } = $props();
</script>

<Table.Root>
	<Table.Header>
		<Table.Row>
			<Table.Head>Session</Table.Head>
			{#if show_model}<Table.Head class="hidden lg:table-cell"
					>Model</Table.Head
				>{/if}
			<Table.Head class="text-right">Turns</Table.Head>
			<Table.Head class="text-right">Tool errors</Table.Head>
			<Table.Head class="hidden text-right sm:table-cell"
				>Tokens</Table.Head
			>
			<Table.Head class="text-right">Cost</Table.Head>
			<Table.Head class="text-right">Last active</Table.Head>
		</Table.Row>
	</Table.Header>
	<Table.Body>
		{#each sessions as session (session.session_id)}
			{@const active = live.is_active(
				session.session_id,
				session.last_ts,
			)}
			<Table.Row class="relative">
				<Table.Cell class="max-w-72">
					<a
						href={session_href(session.session_id)}
						class="block truncate font-medium after:absolute after:inset-0 hover:underline"
					>
						{session_title(session)}
					</a>
					<span class="block truncate text-xs text-muted-foreground"
						>{repo_name(session)}</span
					>
				</Table.Cell>
				{#if show_model}
					<Table.Cell
						class="hidden font-mono text-xs text-muted-foreground lg:table-cell"
						>{session.model ?? '—'}</Table.Cell
					>
				{/if}
				<Table.Cell class="text-right tabular-nums"
					>{session.turns}</Table.Cell
				>
				<Table.Cell
					class={[
						'text-right tabular-nums',
						session.tool_errors > 0
							? 'text-destructive'
							: 'text-muted-foreground',
					]}
				>
					{session.tool_errors}
					<span class="text-muted-foreground"
						>/ {session.tool_calls}</span
					>
				</Table.Cell>
				<Table.Cell
					class="hidden text-right tabular-nums sm:table-cell"
				>
					{number_crunch(
						session.input_tokens + session.output_tokens,
					)}
				</Table.Cell>
				<Table.Cell class="text-right tabular-nums"
					>{money(session.cost_usd)}</Table.Cell
				>
				<Table.Cell class="text-right whitespace-nowrap">
					{#if active}
						<Badge variant="outline" class="gap-1.5">
							<span class="size-1.5 rounded-full bg-success"
							></span>Live
						</Badge>
					{:else}
						<span class="text-muted-foreground"
							>{relative_time(session.last_ts, live.now)}</span
						>
					{/if}
				</Table.Cell>
			</Table.Row>
		{:else}
			<Table.Row>
				<Table.Cell
					colspan={7}
					class="py-8 text-center text-muted-foreground"
				>
					No sessions in this range.
				</Table.Cell>
			</Table.Row>
		{/each}
	</Table.Body>
</Table.Root>
