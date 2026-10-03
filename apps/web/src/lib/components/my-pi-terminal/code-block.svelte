<script lang="ts">
	import { highlight_line } from './syntax';

	let { code }: { code: string } = $props();
</script>

<div class="code">
	{#each code.split('\n') as line, idx (idx)}
		{@const toks = highlight_line(line)}
		<!-- prettier-ignore -->
		<div class="code-line">{#if toks.length === 0}&nbsp;{:else}{#each toks as tok, ti (ti)}<span class="tok tok-{tok.t}">{tok.v}</span>{/each}{/if}</div>
	{/each}
</div>
