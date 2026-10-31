<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CopyIcon from '@lucide/svelte/icons/copy';

	let { value, label = 'Copy' }: { value: string; label?: string } =
		$props();

	let copied = $state(false);

	async function copy(): Promise<void> {
		try {
			await navigator.clipboard.writeText(value);
			copied = true;
			setTimeout(() => (copied = false), 1_500);
		} catch {
			// Clipboard access can be refused; the value stays on screen.
		}
	}
</script>

<Button
	variant="ghost"
	size="icon-sm"
	aria-label={label}
	title={label}
	onclick={copy}
>
	{#if copied}<CheckIcon />{:else}<CopyIcon />{/if}
</Button>
