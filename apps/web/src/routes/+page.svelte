<script lang="ts">
	import CommandLine from '#lib/components/command-line.svelte';
	import FaqItem from '#lib/components/faq-item.svelte';
	import MyPiHero from '#lib/components/my-pi-hero.svelte';
	import PixelRule from '#lib/components/pixel-rule.svelte';
	import SessionLog from '#lib/components/session-log.svelte';
	import {
		ArrowSquareOutIcon,
		GithubLogoIcon,
		PackageIcon,
	} from 'phosphor-svelte';
	import { Head, SchemaOrg } from 'svead';
	import {
		faq_lines,
		layer_packages,
		logo_lines,
		package_groups,
		page_schema,
		seo_config,
		stack_rows,
		stack_tree,
		support_packages,
	} from './page-content.js';

	let { data } = $props();

	const hero_copy = $derived({
		logo_lines,
		code: data.hero_code.lines,
		code_path: data.hero_code.path,
		stack: stack_tree,
		prompt: 'pnpx my-pi@latest',
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
	const group_colors = ['#ccff00', '#ff00cc', '#00eaff'];

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
<SchemaOrg schema={page_schema} />

<main>
	<section class="hero-section">
		<MyPiHero copy={hero_copy} />
	</section>

	<div class="site">
		<section class="intro" aria-labelledby="intro-heading">
			<div class="intro-copy">
				<h1 id="intro-heading">
					Run Pi with project tools already connected.
				</h1>
				<p class="lede">
					my-pi is a ready-to-run coding-agent CLI with the tools and
					workflows this repository actually uses: scoped MCP, LSP,
					skills, context, recall, guardrails, observability, and peer
					coordination.
				</p>

				<CommandLine command="pnpx my-pi@latest" echo />

				<nav class="links" aria-label="Project links">
					<a href="https://github.com/spences10/my-pi">
						<GithubLogoIcon aria-hidden="true" /> View source on GitHub
					</a>
					<a href="https://www.npmjs.com/package/my-pi">
						<PackageIcon aria-hidden="true" /> View my-pi on npm
					</a>
				</nav>
			</div>

			<aside class="plates" aria-label="Distribution contents">
				<ol>
					{#each stack_tree as [layer, contents], index (layer)}
						<li style:--band={band_colors[index]}>
							<button
								type="button"
								aria-pressed={selected_layer === layer}
								class:dimmed={selected_layer &&
									selected_layer !== layer}
								onclick={() =>
									(selected_layer =
										selected_layer === layer ? undefined : layer)}
							>
								<strong>{layer}</strong>
								<span>{contents}</span>
							</button>
						</li>
					{/each}
				</ol>
				<p
					class="layer-detail"
					style:--band={selected_color}
					aria-live="polite"
				>
					{#if !selected_layer}
						Select a layer to see its packages.
					{:else if selected_packages.length}
						{#each selected_packages as name (name)}
							<a href={`#pkg-${name}`}>@spences10/{name}</a>
						{/each}
					{:else}
						This layer is Pi itself. my-pi adds no package here.
					{/if}
				</p>
				<p class="local">
					<i aria-hidden="true"></i> context, recall, and telemetry stay
					local
				</p>
				<p class="facts">
					{#if data.version}my-pi {data.version} /{/if}
					node &gt;=24.15.0 / tui, print, json, rpc / built on Pi
				</p>
			</aside>
		</section>

		<PixelRule />

		<section class="session" aria-labelledby="session-heading">
			<header class="section-head">
				<h2 id="session-heading">Recall, edit, validate</h2>
				<p>
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

		<section class="workflows" aria-labelledby="workflows-heading">
			<header class="section-head">
				<h2 id="workflows-heading">
					How my-pi supports recurring development work
				</h2>
				<p>
					These workflows recur across real project sessions and show
					when each part of my-pi is useful.
				</p>
			</header>

			<ul class="workflow-list">
				{#each stack_rows as row (row.label)}
					<li>
						<h3>{row.label}</h3>
						<p>{row.body}</p>
						<code>{row.packages}</code>
					</li>
				{/each}
			</ul>
		</section>

		<PixelRule />

		<section class="install" aria-labelledby="install-heading">
			<header class="section-head">
				<h2 id="install-heading">Choose how to use my-pi</h2>
			</header>
			<div class="install-grid">
				<div class="install-option echo">
					<h3>Run the distribution</h3>
					<p>
						Choose this when you want all included extensions and
						my-pi defaults configured together.
					</p>
					<CommandLine command="pnpx my-pi@latest" />
					<small>
						Also works with npx or bunx. Do not use
						<code>pi install</code>.
					</small>
				</div>
				<div class="install-option">
					<h3>Add one package</h3>
					<p>
						Choose this when you already use Pi and only want one
						extension from this repository.
					</p>
					<CommandLine command="pi install npm:@spences10/pi-lsp" />
					<a href="#packages"
						>View all {package_count} installable packages</a
					>
				</div>
			</div>
		</section>

		<PixelRule />

		<section
			id="packages"
			class="packages"
			aria-labelledby="packages-heading"
		>
			<header class="section-head">
				<h2 id="packages-heading">
					Install selected extensions into your Pi setup.
				</h2>
				<p>
					Every row opens its package README, the source of truth for
					commands, configuration, and runtime behavior.
				</p>
			</header>

			<div class="package-groups">
				{#each package_groups as group, group_index (group.label)}
					<section style:--band={group_colors[group_index]}>
						<h3>{group.label}</h3>
						<ul>
							{#each group.packages as [name, description] (name)}
								<li
									id={`pkg-${name}`}
									class:marked={selected_packages.includes(name)}
									style:--mark={selected_color}
								>
									<a
										href={`https://github.com/spences10/my-pi/tree/main/packages/${name}`}
									>
										<code><span>@spences10/</span>{name}</code>
										<small>{description}</small>
										<ArrowSquareOutIcon aria-hidden="true" />
									</a>
								</li>
							{/each}
						</ul>
					</section>
				{/each}
			</div>

			<aside
				class="support-packages"
				aria-label="Published support packages"
			>
				<p>
					Support dependencies: published, but not installed directly.
				</p>
				<div>
					{#each support_packages as name (name)}
						<code>@spences10/{name}</code>
					{/each}
				</div>
			</aside>
		</section>

		<PixelRule />

		<section class="help" aria-labelledby="help-heading">
			<h2 id="help-heading">
				Installation and compatibility questions
			</h2>
			<div class="help-list">
				{#each faq_lines as [question, answer] (question)}
					<FaqItem {question} {answer} />
				{/each}
			</div>
		</section>

		<PixelRule />

		<section class="closing" aria-labelledby="closing-heading">
			<h2 id="closing-heading">
				Run the full setup. Or install only what you need.
			</h2>
			<div class="closing-line">
				<CommandLine command="pnpx my-pi@latest" echo />
				<a href="https://github.com/spences10/my-pi">
					<GithubLogoIcon aria-hidden="true" /> Open the GitHub repository
				</a>
			</div>
		</section>
	</div>
</main>

<footer class="page-footer">
	<p><span>my-pi</span> / curated Pi coding-agent distribution</p>
	<nav aria-label="Footer">
		<a href="https://github.com/spences10/my-pi">GitHub repository</a>
		<a href="https://www.npmjs.com/package/my-pi">my-pi on npm</a>
		<a href="#packages">Installable packages</a>
	</nav>
</footer>

<style>
	:global(html) {
		scroll-behavior: smooth;
	}

	main {
		overflow: hidden;
	}

	.hero-section {
		display: grid;
		place-items: center;
		min-height: 100svh;
		padding: 2.5rem 1.25rem;
	}

	.site,
	.page-footer {
		--line: color-mix(
			in srgb,
			var(--afterglow-border-variant) 76%,
			transparent
		);
		--copy: color-mix(
			in srgb,
			var(--afterglow-text) 78%,
			transparent
		);

		width: min(72rem, calc(100% - 2.5rem));
		margin-inline: auto;
		font-family: var(--font-mono);
	}

	.site > section {
		padding-block: clamp(4rem, 9vw, 7.5rem);
	}

	.site > section.intro {
		padding-top: clamp(1rem, 4vw, 3rem);
	}

	h1,
	h2,
	h3 {
		margin: 0;
		font-family: var(--font-mono);
		text-wrap: balance;
	}

	p {
		text-wrap: pretty;
	}

	h1 {
		max-width: 14ch;
		font-size: clamp(2.3rem, 5.2vw, 4.6rem);
		font-weight: 760;
		line-height: 1.02;
		letter-spacing: -0.055em;
	}

	h2 {
		max-width: 22ch;
		font-size: clamp(1.7rem, 3.6vw, 3rem);
		font-weight: 740;
		line-height: 1.08;
		letter-spacing: -0.05em;
	}

	h3 {
		font-size: 1.05rem;
		font-weight: 720;
		letter-spacing: -0.02em;
	}

	.section-head {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(18rem, 0.6fr);
		gap: clamp(1.5rem, 6vw, 6rem);
		align-items: end;
		margin-bottom: clamp(2rem, 4vw, 3.25rem);
	}

	.section-head p,
	.lede,
	.workflow-list p,
	.install-option p {
		margin: 0;
		color: var(--copy);
		font-family: var(--font-sans);
		line-height: 1.7;
	}

	/* Intro */
	.intro {
		display: grid;
		grid-template-columns: minmax(0, 1.1fr) minmax(19rem, 0.9fr);
		gap: clamp(2.5rem, 7vw, 6rem);
		align-items: center;
	}

	.lede {
		max-width: 54ch;
		margin: 1.75rem 0 2.25rem;
		font-size: clamp(1rem, 1.7vw, 1.15rem);
	}

	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1.5rem;
		margin-top: 2.25rem;
	}

	.links a,
	.install-option a,
	.closing a {
		display: inline-flex;
		gap: 0.45rem;
		align-items: center;
		color: var(--afterglow-terminal-cyan);
		font-size: 0.8rem;
		font-weight: 700;
		text-decoration: none;
	}

	.links :global(svg),
	.closing :global(svg) {
		width: 1rem;
	}

	/* The stack, drawn as the five plates of the hero. */
	.plates ol {
		display: flex;
		flex-direction: column-reverse;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.plates button {
		display: grid;
		grid-template-columns: 8.5rem 1fr;
		gap: 1rem;
		align-items: baseline;
		width: 100%;
		padding: 0.85rem 1rem;
		border: 0;
		border-left: 0.75rem solid var(--band);
		background: color-mix(in srgb, var(--band) 13%, transparent);
		color: inherit;
		font: inherit;
		font-size: 0.8rem;
		text-align: left;
		cursor: pointer;
		transition:
			background-color 150ms ease,
			opacity 150ms ease,
			translate 150ms ease;
	}

	.plates button:hover,
	.plates button[aria-pressed='true'] {
		background: color-mix(in srgb, var(--band) 30%, transparent);
	}

	.plates button[aria-pressed='true'] {
		translate: 0.5rem 0;
	}

	.plates button.dimmed {
		opacity: 0.55;
	}

	.plates strong {
		color: var(--band);
		font-weight: 720;
	}

	.plates button span {
		color: var(--copy);
	}

	.layer-detail {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 1rem;
		min-height: 2.6rem;
		margin: 0.9rem 0 0;
		color: var(--afterglow-text-muted);
		font-size: 0.78rem;
	}

	.layer-detail a {
		color: var(--band);
		font-weight: 700;
		text-decoration: none;
	}

	.layer-detail a:hover {
		text-decoration: underline;
	}

	.local,
	.facts {
		margin: 1.25rem 0 0;
		color: var(--afterglow-text-muted);
		font-size: 0.72rem;
	}

	.facts {
		margin-top: 0.4rem;
	}

	.local i {
		display: inline-block;
		width: 0.5rem;
		height: 0.5rem;
		margin-right: 0.4rem;
		background: var(--afterglow-terminal-green);
	}

	/* Workflows */
	.workflow-list {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0 clamp(2rem, 5vw, 4.5rem);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.workflow-list li {
		display: grid;
		gap: 0.7rem;
		align-content: start;
		padding-block: 1.6rem;
		border-top: 1px solid var(--line);
	}

	.workflow-list p {
		font-size: 0.94rem;
	}

	.workflow-list code {
		color: var(--afterglow-terminal-cyan);
		font-size: 0.72rem;
	}

	/* Install */
	.install-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: clamp(1.75rem, 4vw, 3rem);
	}

	.install-option {
		display: grid;
		gap: 1.1rem;
		align-content: start;
		padding: clamp(1.5rem, 4vw, 2.75rem);
		border: 1px solid var(--line);
		background: var(--afterglow-elevated-surface-background);
	}

	.install-option h3 {
		font-size: clamp(1.3rem, 2.4vw, 1.8rem);
		letter-spacing: -0.04em;
	}

	.install-option p {
		font-size: 0.94rem;
	}

	.install-option small {
		color: var(--afterglow-text-muted);
		font-size: 0.72rem;
		line-height: 1.55;
	}

	/* Packages */
	.package-groups > section {
		display: grid;
		grid-template-columns: minmax(10rem, 0.3fr) 1fr;
		gap: 1rem;
		padding-block: clamp(1.5rem, 3vw, 2.5rem);
		border-top: 1px solid var(--line);
	}

	.package-groups h3 {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		align-self: start;
		color: var(--band);
		font-size: 0.85rem;
	}

	.package-groups h3::before {
		width: 0.7rem;
		height: 0.7rem;
		background: var(--band);
		content: '';
	}

	.package-groups ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.package-groups li {
		scroll-margin-top: 6rem;
		transition: background-color 200ms ease;
	}

	.package-groups li.marked {
		background: color-mix(in srgb, var(--mark) 14%, transparent);
		box-shadow: inset 0.4rem 0 0 var(--mark);
	}

	.package-groups li.marked a {
		padding-left: 1rem;
	}

	.package-groups li + li {
		border-top: 1px solid
			color-mix(in srgb, var(--line) 60%, transparent);
	}

	.package-groups a {
		display: grid;
		grid-template-columns: minmax(14rem, 0.78fr) 1.22fr auto;
		gap: 1rem;
		align-items: center;
		padding: 0.85rem 0;
		color: inherit;
		text-decoration: none;
	}

	.package-groups a > code {
		font-size: 0.78rem;
		font-weight: 700;
	}

	.package-groups a > code span {
		color: var(--afterglow-text-muted);
		font-weight: 400;
	}

	.package-groups a > small {
		color: var(--copy);
		font-family: var(--font-sans);
		font-size: 0.84rem;
		line-height: 1.45;
	}

	.package-groups a :global(svg) {
		width: 0.9rem;
		color: var(--afterglow-comment);
	}

	.package-groups a:hover > code,
	.package-groups a:focus-visible > code,
	.package-groups a:hover :global(svg),
	.package-groups a:focus-visible :global(svg) {
		color: var(--band);
	}

	.support-packages {
		display: grid;
		grid-template-columns: minmax(10rem, 0.3fr) 1fr;
		gap: 1rem;
		padding-top: 1.5rem;
		border-top: 1px solid var(--line);
		color: var(--afterglow-text-muted);
		font-size: 0.7rem;
		line-height: 1.55;
	}

	.support-packages p {
		margin: 0;
	}

	.support-packages div {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
	}

	/* Help */
	.help {
		display: grid;
		grid-template-columns: minmax(13rem, 0.5fr) 1fr;
		gap: clamp(2.5rem, 7vw, 6rem);
	}

	.help h2 {
		font-size: clamp(1.5rem, 2.8vw, 2.3rem);
	}

	.help-list {
		border-top: 1px solid var(--line);
	}

	/* Closing */
	.closing h2 {
		max-width: 18ch;
		font-size: clamp(2rem, 4.4vw, 3.8rem);
	}

	.closing-line {
		display: flex;
		flex-wrap: wrap;
		gap: 2rem 2.5rem;
		align-items: center;
		margin-top: 2.5rem;
	}

	.page-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 2rem;
		padding-block: 1.5rem 2.5rem;
		border-top: 1px solid var(--line);
		color: var(--afterglow-comment);
		font-size: 0.7rem;
	}

	.page-footer p {
		margin: 0;
	}

	.page-footer p span {
		color: var(--afterglow-text);
	}

	.page-footer nav {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.4rem;
	}

	.page-footer a {
		color: inherit;
		text-decoration: none;
	}

	.links a:hover,
	.install-option a:hover,
	.closing a:hover,
	.page-footer a:hover {
		color: var(--afterglow-terminal-magenta);
	}

	@media (max-width: 860px) {
		.intro,
		.section-head,
		.workflow-list,
		.install-grid,
		.help {
			grid-template-columns: 1fr;
		}

		.section-head {
			gap: 1.25rem;
		}

		.package-groups > section,
		.support-packages {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 580px) {
		.site,
		.page-footer {
			width: calc(100% - 2rem);
		}

		.plates button {
			grid-template-columns: 1fr;
			gap: 0.25rem;
		}

		.package-groups a {
			grid-template-columns: 1fr auto;
			gap: 0.4rem;
		}

		.package-groups a > code {
			overflow-wrap: anywhere;
		}

		.package-groups a > small {
			grid-column: 1 / -1;
			grid-row: 2;
		}

		.page-footer {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
