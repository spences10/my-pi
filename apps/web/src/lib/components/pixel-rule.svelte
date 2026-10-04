<script lang="ts">
	import type { Attachment } from 'svelte/attachments';

	// The blocks light from left to right when the rule scrolls into view.
	const light_on_view: Attachment<HTMLElement> = (rule) => {
		rule.dataset.armed = '';
		const observer = new IntersectionObserver(
			([entry]) => {
				if (!entry.isIntersecting) return;
				rule.dataset.lit = '';
				observer.disconnect();
			},
			{ rootMargin: '0px 0px -12% 0px' },
		);
		observer.observe(rule);
		return () => observer.disconnect();
	};
</script>

<div
	class="pixel-rule"
	role="separator"
	{@attach light_on_view}
></div>

<style>
	/* A row of blocks in the logo gradient: one block for each logo column. */
	.pixel-rule {
		position: relative;
		height: 0.5rem;
		mask-image: repeating-linear-gradient(
			90deg,
			#000 0 calc(2.5% - 4px),
			transparent calc(2.5% - 4px) 2.5%
		);
	}

	.pixel-rule::before,
	.pixel-rule::after {
		position: absolute;
		inset: 0;
		background: linear-gradient(
			90deg,
			var(--afterglow-terminal-green),
			var(--afterglow-terminal-yellow),
			var(--afterglow-terminal-magenta),
			var(--afterglow-terminal-blue)
		);
		content: '';
	}

	.pixel-rule::before {
		opacity: 0.2;
	}

	.pixel-rule::after {
		clip-path: inset(0 0 0 0);
		opacity: 0.9;
		transition: clip-path 900ms steps(40);
	}

	.pixel-rule:global([data-armed]:not([data-lit]))::after {
		clip-path: inset(0 100% 0 0);
	}
</style>
