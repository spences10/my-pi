<script lang="ts">
	import { ArrowCounterClockwiseIcon } from 'phosphor-svelte';
	import type { Attachment } from 'svelte/attachments';
	import {
		create_hero_scene,
		HERO_DURATION,
		HERO_FONT,
		type HeroCopy,
	} from './my-pi-hero/scene.js';

	let { copy }: { copy: HeroCopy } = $props();

	let replays = $state(0);
	let finished = $state(false);

	// Plays one time, then stops on the logo. Reading `replays` makes the
	// attachment run again for a replay.
	const hero: Attachment<HTMLCanvasElement> = (canvas) => {
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const scene = create_hero_scene(copy);
		const compact_query = matchMedia('(max-width: 640px)');
		const reduced_motion =
			replays === 0 &&
			matchMedia('(prefers-reduced-motion: reduce)').matches;

		let elapsed = reduced_motion ? HERO_DURATION : 0;
		let last_time = 0;
		let frame = 0;
		let visible = false;
		let font_ready = false;

		const paint = () => {
			const { width } = scene.size(compact_query.matches);
			const scale = canvas.width / width;
			ctx.setTransform(scale, 0, 0, scale, 0, 0);
			scene.draw(ctx, elapsed, compact_query.matches);
		};
		const tick = (now: number) => {
			frame = 0;
			elapsed = Math.min(
				HERO_DURATION,
				elapsed + Math.min(0.1, (now - last_time) / 1000),
			);
			last_time = now;
			paint();
			if (elapsed >= HERO_DURATION) finished = true;
			else play();
		};
		const play = () => {
			if (
				frame ||
				!visible ||
				!font_ready ||
				elapsed >= HERO_DURATION
			)
				return;
			if (!last_time) last_time = performance.now();
			frame = requestAnimationFrame(tick);
		};
		const pause = () => {
			cancelAnimationFrame(frame);
			frame = 0;
			last_time = 0;
		};
		const resize = () => {
			const { width, height } = scene.size(compact_query.matches);
			const pixel_ratio = Math.min(devicePixelRatio, 2);
			canvas.width = Math.round(canvas.clientWidth * pixel_ratio);
			canvas.height = Math.round((canvas.width * height) / width);
			paint();
		};

		finished = elapsed >= HERO_DURATION;
		const resize_observer = new ResizeObserver(resize);
		resize_observer.observe(canvas);
		const visibility_observer = new IntersectionObserver(
			([entry]) => {
				visible = entry.isIntersecting;
				if (visible) play();
				else pause();
			},
		);
		visibility_observer.observe(canvas);
		document.fonts.load(HERO_FONT).finally(() => {
			font_ready = true;
			paint();
			play();
		});

		return () => {
			pause();
			resize_observer.disconnect();
			visibility_observer.disconnect();
		};
	};
</script>

<div class="hero">
	<div class="hero-glow"></div>
	<div
		class="hero-frame"
		role="img"
		aria-label="My-Pi logo, built from coloured cubes"
	>
		<canvas {@attach hero} aria-hidden="true"></canvas>
	</div>
	<a class="hero-link" href="https://github.com/spences10/my-pi">
		github.com/spences10/my-pi
	</a>
	{#if finished}
		<button
			class="hero-replay"
			type="button"
			aria-label="Replay the logo animation"
			onclick={() => replays++}
		>
			<ArrowCounterClockwiseIcon aria-hidden="true" />
		</button>
	{/if}
</div>

<style>
	.hero {
		position: relative;
		width: min(64rem, 100%);
	}

	.hero-glow {
		position: absolute;
		inset: -5rem;
		z-index: -1;
		background: radial-gradient(
			circle,
			var(--afterglow-terminal-magenta) 0%,
			transparent 58%
		);
		opacity: 0.2;
		filter: blur(64px);
	}

	.hero-frame {
		overflow: hidden;
		border-radius: 1.35rem;
		background: var(--afterglow-background);
		box-shadow: 0 0 80px rgb(255 0 204 / 0.18);
	}

	canvas {
		display: block;
		width: 100%;
		aspect-ratio: 16 / 9;
	}

	.hero-link {
		display: block;
		margin-top: 1.75rem;
		color: var(--afterglow-text-muted);
		font-family: var(--font-mono);
		font-size: 0.875rem;
		text-align: center;
		transition: color 150ms ease;
	}

	.hero-replay {
		position: absolute;
		right: 0;
		bottom: -0.5rem;
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border: 1px solid var(--afterglow-border-variant);
		background: transparent;
		color: var(--afterglow-text-muted);
		cursor: pointer;
		transition:
			color 150ms ease,
			border-color 150ms ease;
	}

	.hero-link:hover,
	.hero-replay:hover {
		color: var(--afterglow-terminal-magenta);
	}

	.hero-replay:hover {
		border-color: var(--afterglow-terminal-magenta);
	}

	@media (max-width: 640px) {
		canvas {
			aspect-ratio: 1;
		}
	}
</style>
