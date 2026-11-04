<script lang="ts">
	import CommandLine from '#lib/components/command-line.svelte';
	import FaqItem from '#lib/components/faq-item.svelte';
	import MyPiHero from '#lib/components/my-pi-hero.svelte';
	import PixelRule from '#lib/components/pixel-rule.svelte';
	import SessionLog from '#lib/components/session-log.svelte';
	import { logo_lines } from '#lib/config/logo.js';
	import { site_config } from '#lib/config/site.js';
	import {
		ArrowSquareOutIcon,
		GithubLogoIcon,
		PackageIcon,
	} from 'phosphor-svelte';
	import { Head, SchemaOrg } from 'svead';
	import {
		get_faq_lines,
		layer_packages,
		package_groups,
		package_managers,
		page_schema,
		seo_config,
		stack_rows,
		stack_tree,
		support_packages,
	} from './page-content.js';

	let { data } = $props();

	let package_manager = $state<keyof typeof package_managers>('pnpm');
	const launch_command = $derived(package_managers[package_manager]);
	const faq_lines = $derived(get_faq_lines(launch_command));

	const hero_copy = $derived({
		logo_lines,
		code: data.hero_code.lines,
		code_path: data.hero_code.path,
		stack: stack_tree,
		prompt: launch_command,
		comment: '// a curated Pi distribution',
		headline: 'Run Pi with project tools already connected.',
		status: 'context, recall, and telemetry stay local',
		tagline: 'a curated Pi coding-agent distribution',
	});

	// One colour for each stack layer, sampled from the logo gradient.
	const band_colors = [
		'#ccff00',
		'#f2c400',
		'#ff5866',
		'#bf3ad9',
		'#00eaff',
	];
	const group_colors = ['#ccff00', '#ff00cc', '#00eaff', '#f2c400'];

	const package_count = package_groups.reduce(
		(total, group) => total + group.packages.length,
		0,
	);

	// A selected plate shows its packages and marks them in the package list.
	let selected_layer = $state<string>();
	const selected_packages = $derived(
		selected_layer ? layer_packages[selected_layer] : [],
	);
	const selected_color = $derived(
		band_colors[
			stack_tree.findIndex(([layer]) => layer === selected_layer)
		],
	);
</script>

<Head {seo_config} />
<SchemaOrg schema={page_schema(data.version, launch_command)} />

<svelte:head>
	<meta property="og:image:type" content="image/png" />
	<meta
		property="og:image:width"
		content={String(site_config.share_card.width)}
	/>
	<meta
		property="og:image:height"
		content={String(site_config.share_card.height)}
	/>
	<meta name="theme-color" content={site_config.theme_color} />
</svelte:head>

<main class="overflow-hidden">
	<section class="grid min-h-svh place-items-center px-5 py-10">
		<MyPiHero copy={hero_copy} />
	</section>

	<div
		class="site mx-auto w-[calc(100%-2.5rem)] max-w-6xl font-mono narrow:w-[calc(100%-2rem)]"
	>
		<section
			class="intro grid grid-cols-[minmax(0,1.1fr)_minmax(19rem,0.9fr)] items-center gap-[clamp(2.5rem,7vw,6rem)] pt-[clamp(1rem,4vw,3rem)] pb-[clamp(4rem,9vw,7.5rem)] compact:grid-cols-1"
			aria-labelledby="intro-heading"
		>
			<div>
				<h1
					id="intro-heading"
					class="max-w-[14ch] text-[clamp(2.3rem,5.2vw,4.6rem)] leading-[1.02] font-[760] tracking-[-0.055em] text-balance"
				>
					Run Pi with project tools already connected.
				</h1>
				<p
					class="mt-7 mb-9 max-w-[54ch] font-sans text-[clamp(1rem,1.7vw,1.15rem)] leading-[1.7] text-pretty text-copy"
				>
					my-pi runs upstream Pi with every extension in this
					repository built in: LSP, a context sidecar, recall,
					redaction, guardrails, observability, and peer coordination.
					Turn each one on or off with <code>/extensions</code>.
				</p>

				<div class="grid w-fit max-w-full gap-[0.6rem]">
					<fieldset class="flex gap-1 text-xs/normal">
						<legend class="sr-only">Package manager</legend>
						{#each Object.keys(package_managers) as manager (manager)}
							<label class="group">
								<input
									class="peer sr-only"
									type="radio"
									name="package-manager"
									value={manager}
									bind:group={package_manager}
								/>
								<span
									class="block cursor-pointer border border-transparent px-3 py-[0.35rem] text-muted group-hover:text-green peer-checked:border-border peer-checked:bg-background peer-checked:text-green peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-cyan"
								>
									{manager === 'bun' ? 'Bun' : manager}
								</span>
							</label>
						{/each}
					</fieldset>
					<CommandLine command={launch_command} echo />
				</div>

				<nav
					class="mt-9 flex flex-wrap gap-x-6 gap-y-3"
					aria-label="Project links"
				>
					<a
						class="inline-flex items-center gap-[0.45rem] text-[0.8rem] font-bold text-cyan hover:text-magenta"
						href="https://github.com/spences10/my-pi"
					>
						<GithubLogoIcon class="w-4" aria-hidden="true" /> View source
						on GitHub
					</a>
					<a
						class="inline-flex items-center gap-[0.45rem] text-[0.8rem] font-bold text-cyan hover:text-magenta"
						href="https://www.npmjs.com/package/my-pi"
					>
						<PackageIcon class="w-4" aria-hidden="true" /> View my-pi on
						npm
					</a>
				</nav>
			</div>

			<aside class="plates" aria-label="Distribution contents">
				<ol class="flex flex-col-reverse gap-[0.4rem]">
					{#each stack_tree as [layer, contents], index (layer)}
						<li style:--band={band_colors[index]}>
							<button
								type="button"
								aria-pressed={selected_layer === layer}
								class={[
									'grid w-full cursor-pointer grid-cols-[8.5rem_1fr] items-baseline gap-4 border-l-12 border-l-(--band) bg-(--band)/13 px-4 py-[0.85rem] text-left text-[0.8rem] transition-[background-color,opacity,translate] duration-150 ease-[ease] hover:bg-(--band)/30 aria-pressed:translate-x-2 aria-pressed:bg-(--band)/30 narrow:grid-cols-1 narrow:gap-1',
									selected_layer &&
										selected_layer !== layer &&
										'opacity-55',
								]}
								onclick={() =>
									(selected_layer =
										selected_layer === layer ? undefined : layer)}
							>
								<strong class="font-[720] text-(--band)">
									{layer}
								</strong>
								<span class="text-copy">{contents}</span>
							</button>
						</li>
					{/each}
				</ol>
				<p
					class="mt-[0.9rem] flex min-h-[2.6rem] flex-wrap gap-x-4 gap-y-[0.4rem] text-[0.78rem] text-pretty text-muted"
					style:--band={selected_color}
					aria-live="polite"
				>
					{#if !selected_layer}
						Select a layer to see its packages.
					{:else if selected_packages.length}
						{#each selected_packages as name (name)}
							<a
								class="font-bold text-(--band) hover:underline"
								href={`#pkg-${name}`}
							>
								@spences10/{name}
							</a>
						{/each}
					{:else}
						This layer is Pi itself. my-pi adds no package here.
					{/if}
				</p>
				<p class="mt-5 text-[0.72rem] text-pretty text-muted">
					<i
						class="mr-[0.4rem] inline-block size-2 bg-green"
						aria-hidden="true"
					></i> context, recall, and telemetry stay local
				</p>
				<p class="mt-[0.4rem] text-[0.72rem] text-pretty text-muted">
					{#if data.version}my-pi {data.version} /{/if}
					node &gt;=24.15.0 / tui, print, json, rpc / built on Pi
				</p>
			</aside>
		</section>

		<PixelRule />

		<section
			class="py-[clamp(4rem,9vw,7.5rem)]"
			aria-labelledby="session-heading"
		>
			<header
				class="mb-[clamp(2rem,4vw,3.25rem)] grid grid-cols-[minmax(0,1fr)_minmax(18rem,0.6fr)] items-end gap-[clamp(1.5rem,6vw,6rem)] compact:grid-cols-1 compact:gap-5"
			>
				<h2
					id="session-heading"
					class="max-w-[22ch] text-[clamp(1.7rem,3.6vw,3rem)] leading-[1.08] font-[740] tracking-tighter text-balance"
				>
					Recall, edit, validate
				</h2>
				<p class="font-sans leading-[1.7] text-pretty text-copy">
					Recall restores the earlier decision. Terminal tools make
					the change. LSP diagnostics and tests verify the result.
				</p>
			</header>

			<div class="echo">
				<SessionLog
					note="scripted example session"
					conversation={data.session}
				/>
			</div>
		</section>

		<PixelRule />

		<section
			class="py-[clamp(4rem,9vw,7.5rem)]"
			aria-labelledby="workflows-heading"
		>
			<header
				class="mb-[clamp(2rem,4vw,3.25rem)] grid grid-cols-[minmax(0,1fr)_minmax(18rem,0.6fr)] items-end gap-[clamp(1.5rem,6vw,6rem)] compact:grid-cols-1 compact:gap-5"
			>
				<h2
					id="workflows-heading"
					class="max-w-[22ch] text-[clamp(1.7rem,3.6vw,3rem)] leading-[1.08] font-[740] tracking-tighter text-balance"
				>
					How my-pi supports recurring development work
				</h2>
				<p class="font-sans leading-[1.7] text-pretty text-copy">
					These workflows recur across real project sessions and show
					when each part of my-pi is useful.
				</p>
			</header>

			<ul
				class="grid grid-cols-2 gap-x-[clamp(2rem,5vw,4.5rem)] compact:grid-cols-1"
			>
				{#each stack_rows as row (row.label)}
					<li
						class="grid content-start gap-[0.7rem] border-t border-rule py-[1.6rem]"
					>
						<h3
							class="text-[1.05rem] font-[720] tracking-[-0.02em] text-balance"
						>
							{row.label}
						</h3>
						<p
							class="font-sans text-[0.94rem] leading-[1.7] text-pretty text-copy"
						>
							{row.body}
						</p>
						<code class="text-[0.72rem] text-cyan">
							{row.packages}
						</code>
					</li>
				{/each}
			</ul>
		</section>

		<PixelRule />

		<section
			class="install py-[clamp(4rem,9vw,7.5rem)]"
			aria-labelledby="install-heading"
		>
			<header
				class="mb-[clamp(2rem,4vw,3.25rem)] grid grid-cols-[minmax(0,1fr)_minmax(18rem,0.6fr)] items-end gap-[clamp(1.5rem,6vw,6rem)] compact:grid-cols-1 compact:gap-5"
			>
				<h2
					id="install-heading"
					class="max-w-[22ch] text-[clamp(1.7rem,3.6vw,3rem)] leading-[1.08] font-[740] tracking-tighter text-balance"
				>
					Choose how to use my-pi
				</h2>
			</header>
			<div
				class="grid grid-cols-[1fr_1fr] gap-[clamp(1.75rem,4vw,3rem)] compact:grid-cols-[1fr]"
			>
				<div
					class="echo grid content-start gap-[1.1rem] border border-rule bg-surface p-[clamp(1.5rem,4vw,2.75rem)]"
				>
					<h3
						class="text-[clamp(1.3rem,2.4vw,1.8rem)] font-[720] tracking-[-0.04em] text-balance"
					>
						Run the distribution
					</h3>
					<p
						class="font-sans text-[0.94rem] leading-[1.7] text-pretty text-copy"
					>
						Choose this when you want every extension built in. Turn
						any of them off with <code>/extensions</code>.
					</p>
					<CommandLine command={launch_command} />
					<small class="text-[0.72rem] leading-[1.55] text-muted">
						Runs the latest release without a global install. Do not
						use
						<code>pi install</code> for the distribution.
					</small>
				</div>
				<div
					class="grid content-start gap-[1.1rem] border border-rule bg-surface p-[clamp(1.5rem,4vw,2.75rem)]"
				>
					<h3
						class="text-[clamp(1.3rem,2.4vw,1.8rem)] font-[720] tracking-[-0.04em] text-balance"
					>
						Add one package
					</h3>
					<p
						class="font-sans text-[0.94rem] leading-[1.7] text-pretty text-copy"
					>
						Choose this when you already use Pi and only want one
						extension from this repository.
					</p>
					<CommandLine command="pi install npm:@spences10/pi-lsp" />
					<a
						class="inline-flex items-center gap-[0.45rem] text-[0.8rem] font-bold text-cyan hover:text-magenta"
						href="#packages"
					>
						View all {package_count} installable packages
					</a>
				</div>
			</div>
		</section>

		<PixelRule />

		<section
			id="packages"
			class="py-[clamp(4rem,9vw,7.5rem)]"
			aria-labelledby="packages-heading"
		>
			<header
				class="mb-[clamp(2rem,4vw,3.25rem)] grid grid-cols-[minmax(0,1fr)_minmax(18rem,0.6fr)] items-end gap-[clamp(1.5rem,6vw,6rem)] compact:grid-cols-1 compact:gap-5"
			>
				<h2
					id="packages-heading"
					class="max-w-[22ch] text-[clamp(1.7rem,3.6vw,3rem)] leading-[1.08] font-[740] tracking-tighter text-balance"
				>
					Install selected extensions into your Pi setup.
				</h2>
				<p class="font-sans leading-[1.7] text-pretty text-copy">
					Every row opens its package README, the source of truth for
					commands, configuration, and runtime behavior.
				</p>
			</header>

			<div>
				{#each package_groups as group, group_index (group.label)}
					<section
						class="grid grid-cols-[minmax(10rem,0.3fr)_1fr] gap-4 border-t border-rule py-[clamp(1.5rem,3vw,2.5rem)] compact:grid-cols-1"
						style:--band={group_colors[group_index]}
					>
						<h3
							class="flex items-center gap-[0.6rem] self-start text-[0.85rem] font-[720] tracking-[-0.02em] text-balance text-(--band) before:size-[0.7rem] before:bg-(--band) before:content-['']"
						>
							{group.label}
						</h3>
						<ul>
							{#each group.packages as [name, description] (name)}
								<li
									id={`pkg-${name}`}
									class={[
										'scroll-mt-24 transition-[background-color] duration-200 ease-[ease] not-first:border-t not-first:border-rule/60',
										selected_packages.includes(name) &&
											'bg-(--mark)/14 shadow-[inset_0.4rem_0_0_var(--mark)]',
									]}
									style:--mark={selected_color}
								>
									<a
										class={[
											'group grid grid-cols-[minmax(14rem,0.78fr)_1.22fr_auto] items-center gap-4 py-[0.85rem] narrow:grid-cols-[1fr_auto] narrow:gap-[0.4rem]',
											selected_packages.includes(name) && 'pl-4',
										]}
										href={`https://github.com/spences10/my-pi/tree/main/packages/${name}`}
									>
										<code
											class="text-[0.78rem] font-bold group-hover:text-(--band) group-focus-visible:text-(--band) narrow:wrap-anywhere"
										>
											<span class="font-normal text-muted">
												@spences10/
											</span>{name}
										</code>
										<small
											class="font-sans text-[0.84rem] leading-[1.45] text-copy narrow:col-span-full narrow:row-start-2"
										>
											{description}
										</small>
										<ArrowSquareOutIcon
											class="w-[0.9rem] text-comment group-hover:text-(--band) group-focus-visible:text-(--band)"
											aria-hidden="true"
										/>
									</a>
								</li>
							{/each}
						</ul>
					</section>
				{/each}
			</div>

			<aside
				class="grid grid-cols-[minmax(10rem,0.3fr)_1fr] gap-4 border-t border-rule pt-6 text-[0.7rem] leading-[1.55] text-muted compact:grid-cols-1"
				aria-label="Published support packages"
			>
				<p class="text-pretty">
					Support dependencies: published, but not installed directly.
				</p>
				<div class="flex flex-wrap gap-x-4 gap-y-2">
					{#each support_packages as name (name)}
						<code>@spences10/{name}</code>
					{/each}
				</div>
			</aside>
		</section>

		<PixelRule />

		<section
			class="help grid grid-cols-[minmax(13rem,0.5fr)_1fr] gap-[clamp(2.5rem,7vw,6rem)] py-[clamp(4rem,9vw,7.5rem)] compact:grid-cols-1"
			aria-labelledby="help-heading"
		>
			<h2
				id="help-heading"
				class="max-w-[22ch] text-[clamp(1.5rem,2.8vw,2.3rem)] leading-[1.08] font-[740] tracking-tighter text-balance"
			>
				Installation and compatibility questions
			</h2>
			<div class="border-t border-rule">
				{#each faq_lines as [question, answer] (question)}
					<FaqItem {question} {answer} />
				{/each}
			</div>
		</section>

		<PixelRule />

		<section
			class="closing py-[clamp(4rem,9vw,7.5rem)]"
			aria-labelledby="closing-heading"
		>
			<h2
				id="closing-heading"
				class="max-w-[18ch] text-[clamp(2rem,4.4vw,3.8rem)] leading-[1.08] font-[740] tracking-tighter text-balance"
			>
				Run the full setup. Or install only what you need.
			</h2>
			<div class="mt-10 flex flex-wrap items-center gap-x-10 gap-y-8">
				<CommandLine command={launch_command} echo />
				<a
					class="inline-flex items-center gap-[0.45rem] text-[0.8rem] font-bold text-cyan hover:text-magenta"
					href="https://github.com/spences10/my-pi"
				>
					<GithubLogoIcon class="w-4" aria-hidden="true" /> Open the GitHub
					repository
				</a>
			</div>
		</section>
	</div>
</main>

<footer
	class="page-footer mx-auto flex w-[calc(100%-2.5rem)] max-w-6xl items-center justify-between gap-8 border-t border-rule pt-6 pb-10 font-mono text-[0.7rem] text-comment narrow:w-[calc(100%-2rem)] narrow:flex-col narrow:items-start"
>
	<p class="text-pretty">
		<span class="text-foreground">my-pi</span> / curated Pi coding-agent
		distribution
	</p>
	<nav
		class="flex flex-wrap gap-x-[1.4rem] gap-y-2"
		aria-label="Footer"
	>
		<a
			class="hover:text-magenta"
			href="https://github.com/spences10/my-pi"
		>
			GitHub repository
		</a>
		<a
			class="hover:text-magenta"
			href="https://www.npmjs.com/package/my-pi"
		>
			my-pi on npm
		</a>
		<a class="hover:text-magenta" href="#packages">
			Installable packages
		</a>
	</nav>
</footer>
