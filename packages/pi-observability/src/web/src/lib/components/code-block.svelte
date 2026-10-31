<script lang="ts">
	import CopyButton from '#lib/components/copy-button.svelte';
	import { highlight, type CodeLanguage } from '#lib/highlight.js';
	import { cn } from '#lib/utils.js';

	let {
		code,
		language,
		label,
		class: class_name,
	}: {
		code: string;
		language: CodeLanguage;
		/** Header text; the copy button shows only with a label. */
		label?: string;
		class?: string;
	} = $props();

	const html = $derived(highlight(code, language));
</script>

<div
	class={cn(
		'overflow-hidden rounded-lg border bg-(--twp-background)',
		class_name,
	)}
>
	{#if label}
		<div class="flex items-center gap-2 border-b py-1 pr-1 pl-3">
			<span class="mr-auto text-xs font-medium text-muted-foreground"
				>{label}</span
			>
			<CopyButton value={code} label="Copy {label.toLowerCase()}" />
		</div>
	{/if}
	<!-- twinkleplop escapes the input; highlight() falls back to escaped text. -->
	<div class="max-h-[inherit] overflow-auto [&_pre]:min-w-full">
		{@html html}
	</div>
</div>
