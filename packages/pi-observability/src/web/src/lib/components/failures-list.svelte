<script lang="ts">
	import { Badge } from '#lib/components/ui/badge/index.js';
	import {
		duration,
		relative_time,
		repo_name,
		session_title,
		tool_label,
	} from '#lib/format.js';
	import { live } from '#lib/live.svelte.js';
	import { session_href } from '#lib/router.js';
	import type { FailureRow } from '../../../../types';

	let { failures }: { failures: FailureRow[] } = $props();

	// The first line of the output names the problem; the drawer in the
	// trace view shows all of it.
	function first_lines(text: string | null): string {
		if (!text) return 'No error output recorded.';
		return text.trim().split('\n').slice(0, 3).join('\n');
	}
</script>

<ul class="divide-y">
	{#each failures as failure (`${failure.session_id}:${failure.ts}:${failure.span_id}`)}
		<li class="relative grid gap-1 px-4 py-3 hover:bg-muted/50">
			<div
				class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
			>
				<a
					href={session_href(
						failure.session_id,
						'trace',
						failure.span_id,
					)}
					class="font-mono font-medium after:absolute after:inset-0 hover:underline"
				>
					{failure.kind === 'tool'
						? tool_label(failure.name)
						: failure.name}
				</a>
				{#if failure.kind === 'model'}
					<Badge variant="outline">model call</Badge>
				{/if}
				{#if failure.exit_code != null}
					<Badge variant="outline" class="tabular-nums"
						>exit {failure.exit_code}</Badge
					>
				{/if}
				<span class="text-xs text-muted-foreground">
					{session_title(failure)} · {repo_name({
						cwd: failure.cwd ?? '',
					})}
					{#if failure.duration_ms != null}· {duration(
							failure.duration_ms,
						)}{/if}
				</span>
				<span class="ml-auto text-xs text-muted-foreground">
					{relative_time(failure.ts, live.now)}
				</span>
			</div>
			<pre
				class={[
					'line-clamp-3 font-mono text-xs wrap-break-word whitespace-pre-wrap',
					failure.error_text
						? 'text-destructive'
						: 'text-muted-foreground',
				]}>{first_lines(failure.error_text)}</pre>
		</li>
	{:else}
		<li class="px-4 py-8 text-center text-sm text-muted-foreground">
			No failures in this range.
		</li>
	{/each}
</ul>
