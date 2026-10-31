<script lang="ts">
	import type { DashboardEvent } from '#lib/api.js';
	import CodeBlock from '#lib/components/code-block.svelte';
	import { slide_open } from '#lib/motion.js';
	import CopyButton from '#lib/components/copy-button.svelte';
	import * as Collapsible from '#lib/components/ui/collapsible/index.js';
	import { payload_value, text_preview } from '#lib/events.js';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { DashboardSession } from '../../../../../types';

	let {
		session,
		events,
	}: { session: DashboardSession | null; events: DashboardEvent[] } =
		$props();

	const first_prompt = $derived(
		events
			.toSorted((a, b) => a.seq - b.seq)
			.find((event) => event.type === 'agent_start'),
	);
	const last_request = $derived(
		events
			.toSorted((a, b) => b.seq - a.seq)
			.find((event) => event.type === 'provider_request'),
	);
	const reasoning = $derived(
		text_preview(
			payload_value(last_request?.payload, 'payload.reasoning'),
			120,
		),
	);

	const facts = $derived(
		[
			['Session id', session?.session_id],
			['Working directory', session?.cwd],
			['Session file', session?.session_file],
			['Provider', session?.provider],
			['Model', session?.model],
			['Reasoning', reasoning],
			['Pool', session?.pool],
			['Tags', session?.tags.join(', ')],
		].filter((fact): fact is [string, string] => Boolean(fact[1])),
	);

	const prompts = $derived(
		[
			[
				'First user prompt',
				text_preview(first_prompt?.payload.prompt, 8_000),
			],
			[
				'System prompt (preview)',
				text_preview(first_prompt?.payload.systemPrompt, 8_000),
			],
		].filter((prompt): prompt is [string, string] =>
			Boolean(prompt[1]),
		),
	);
</script>

<div class="grid gap-6 px-4 pb-4">
	<dl
		class="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]"
	>
		{#each facts as [label, value] (label)}
			<dt class="text-muted-foreground">{label}</dt>
			<dd class="flex min-w-0 items-start gap-1">
				<span class="font-mono text-xs leading-6 break-all"
					>{value}</span
				>
				<CopyButton {value} label="Copy {label.toLowerCase()}" />
			</dd>
		{/each}
	</dl>

	{#each prompts as [label, text] (label)}
		<Collapsible.Root class="rounded-lg border">
			<Collapsible.Trigger
				class="group flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium"
			>
				<ChevronRightIcon
					class="size-4 transition-transform group-data-[state=open]:rotate-90"
				/>
				{label}
				<span
					class="ml-auto text-xs font-normal text-muted-foreground"
					>{text.length.toLocaleString()} characters</span
				>
			</Collapsible.Trigger>
			<Collapsible.Content forceMount>
				{#snippet child({ props, open })}
					{#if open}
						<div {...props} transition:slide_open>
							<CodeBlock
								code={text}
								language="markdown"
								class="max-h-[32rem] rounded-none border-x-0 border-b-0"
							/>
						</div>
					{/if}
				{/snippet}
			</Collapsible.Content>
		</Collapsible.Root>
	{/each}
</div>
