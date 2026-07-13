<script lang="ts">
	import MyPiTerminal, {
		type Turn,
	} from '$lib/components/my-pi-terminal.svelte';
	import {
		ArrowSquareOutIcon,
		GithubLogoIcon,
		PackageIcon,
		TerminalWindowIcon,
	} from 'phosphor-svelte';
	import { Head, SchemaOrg } from 'svead';
	import {
		faq_lines,
		logo_lines,
		package_groups,
		page_schema,
		seo_config,
		stack_rows,
		stack_tree,
		support_packages,
	} from './page-content.js';

	const demo_conversation: Turn[] = [
		{
			role: 'user',
			text: 'add a token-bucket rate limiter to the public API guard, then run the unit tests',
			delay: 300,
		},
		{
			role: 'working',
			text: 'recalling previous session…',
			duration: 1100,
			delay: 200,
		},
		{
			role: 'assistant',
			text: 'Recall has notes from yesterday: the limiter belongs in the route guard, keyed by client IP. Adding a token bucket and wiring it in.',
			delay: 250,
		},
		{
			role: 'read',
			path: 'src/lib/server/guard.ts',
			range: '1-9',
			code: `import type { RequestEvent } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';

export function guard(event: RequestEvent) {
  // auth + validation runs here
  return event;
}`,
			lines_below: 23,
			total_lines: 32,
			delay: 300,
		},
		{
			role: 'bash',
			command: 'pi lsp diagnostics src/lib/server/guard.ts',
			output: '0 errors · 0 warnings · 4 symbols',
			exit_code: 0,
			delay: 250,
		},
		{
			role: 'diff',
			path: 'src/lib/server/guard.ts',
			hunks: [
				{
					line_number: 3,
					after: [
						'const buckets = new Map<string, number>();',
						'const LIMIT = 60;',
						'',
					],
				},
				{
					line_number: 6,
					before: ['  // auth + validation runs here'],
					after: [
						'  const ip = event.getClientAddress();',
						'  const left = buckets.get(ip) ?? LIMIT;',
						"  if (left <= 0) throw error(429, 'rate limited');",
						'  buckets.set(ip, left - 1);',
					],
				},
			],
			delay: 350,
		},
		{
			role: 'bash',
			command: 'pnpm test:unit -- --run',
			output:
				' Test Files  3 passed (3)\n      Tests  18 passed (18)\n   Duration  1.42s',
			exit_code: 0,
			delay: 300,
		},
		{
			role: 'assistant',
			text: 'Done — limiter in place, LSP shows the file clean, all 18 tests green. Want me to open a PR or hand it to a peer for review?',
			delay: 300,
		},
	];
</script>

<Head {seo_config} />
<SchemaOrg schema={page_schema} />

<main
	class="min-h-screen overflow-hidden bg-background text-foreground"
>
	<section
		class="mx-auto flex min-h-screen max-w-7xl items-center justify-center px-5 py-10 sm:px-8 lg:px-12"
	>
		<div class="relative">
			<div
				class="absolute -inset-20 -z-10 bg-[radial-gradient(circle,var(--afterglow-terminal-magenta)_0%,transparent_58%)] opacity-20 blur-3xl"
			></div>
			<div
				class="rounded-4xl bg-[color-mix(in_srgb,var(--afterglow-surface-background)_88%,black)] shadow-[0_0_80px_rgb(255_0_204/0.18)]"
			>
				<div
					class="rounded-[1.35rem] bg-[#05010a] p-5 font-mono text-[clamp(0.55rem,1.35vw,1.05rem)] leading-none text-accent sm:p-8"
				>
					<pre
						class="logo-gradient mx-auto w-max max-w-full overflow-hidden text-[1em] leading-[0.95] font-black tracking-[-0.08em]">{logo_lines.join(
							'\n',
						)}</pre>
				</div>
			</div>
			<a
				class="mt-7 block text-center font-mono text-sm text-muted transition hover:text-accent"
				href="https://github.com/spences10/my-pi"
			>
				github.com/spences10/my-pi
			</a>
		</div>
	</section>

	<div class="site-shell">
		<section class="manual" aria-labelledby="intro-heading">
			<header class="manual-bar">
				<span>my-pi(1)</span>
				<span>user commands</span>
				<span>my-pi(1)</span>
			</header>

			<div class="manual-grid">
				<div class="manual-copy">
					<p class="comment">// a curated Pi distribution</p>
					<h1 id="intro-heading">
						Pi, with the tools already connected.
					</h1>
					<p class="lede">
						my-pi is a ready-to-run coding-agent CLI with the tools
						and workflows this repository actually uses: scoped MCP,
						LSP, skills, context, recall, guardrails, observability,
						and peer coordination.
					</p>

					<div class="command-line" aria-label="Quick start command">
						<span aria-hidden="true">$</span>
						<code>pnpx my-pi@latest</code>
					</div>

					<nav class="source-links" aria-label="Project links">
						<a href="https://github.com/spences10/my-pi">
							<GithubLogoIcon aria-hidden="true" /> view source
						</a>
						<a href="https://www.npmjs.com/package/my-pi">
							<PackageIcon aria-hidden="true" /> npm
						</a>
					</nav>
				</div>

				<aside class="tree" aria-label="Distribution contents">
					<p>
						<span>my-pi/</span>
						<span class="tree-note">preconfigured CLI</span>
					</p>
					<ul>
						{#each stack_tree as [branch, contents], index (branch)}
							<li>
								<span aria-hidden="true"
									>{index === stack_tree.length - 1
										? '└──'
										: '├──'}</span
								>
								<strong>{branch}</strong>
								<small>{contents}</small>
							</li>
						{/each}
					</ul>
					<div class="tree-status">
						<i></i> context, recall, and telemetry stay local
					</div>
				</aside>
			</div>

			<footer class="manual-status">
				<span>node &gt;=24.15.0</span>
				<span>tui / print / json / rpc</span>
				<span>built on Pi</span>
			</footer>
		</section>

		<section class="session" aria-labelledby="session-heading">
			<header class="command-heading">
				<div>
					<span class="prompt" aria-hidden="true">&gt;</span>
					<h2 id="session-heading">
						session.log / recall → edit → validate
					</h2>
				</div>
				<p>
					Recall restores the earlier decision. Terminal tools make
					the change. LSP diagnostics and tests verify the result.
				</p>
			</header>

			<div class="terminal-frame">
				<p class="terminal-caption">
					<TerminalWindowIcon aria-hidden="true" /> live session playback
				</p>
				<MyPiTerminal
					conversation={demo_conversation}
					loop
					typing_speed={32}
				/>
			</div>
		</section>

		<section class="stack" aria-labelledby="stack-heading">
			<header class="command-heading stack-heading">
				<div>
					<span class="prompt" aria-hidden="true">&gt;</span>
					<h2 id="stack-heading">
						session-history / recurring patterns
					</h2>
				</div>
				<p>
					These workflows recur across real project sessions and show
					when each part of my-pi is useful.
				</p>
			</header>

			<ul class="stack-output">
				{#each stack_rows as row (row.label)}
					<li>
						<span class="output-marker" aria-hidden="true">›</span>
						<div class="output-title">
							<h3>{row.label}</h3>
							<code>{row.packages}</code>
						</div>
						<p>{row.body}</p>
					</li>
				{/each}
			</ul>
		</section>

		<section class="install" aria-labelledby="install-heading">
			<div class="install-bar">
				<span>install.sh</span>
				<span>choose how to use my-pi</span>
			</div>
			<div class="install-grid">
				<div>
					<p class="comment">// run everything preconfigured</p>
					<h2 id="install-heading">Run the distribution</h2>
					<p>
						Choose this when you want all included extensions and
						my-pi defaults configured together.
					</p>
					<div class="command-line compact">
						<span aria-hidden="true">$</span><code
							>pnpx my-pi@latest</code
						>
					</div>
					<small
						>Also works with npx or bunx. Do not use <code
							>pi install</code
						>.</small
					>
				</div>
				<div>
					<p class="comment">// install one extension into Pi</p>
					<h2>Add one package</h2>
					<p>
						Choose this when you already use Pi and only want one
						extension from this repository.
					</p>
					<div class="command-line compact">
						<span aria-hidden="true">$</span><code
							>pi install npm:@spences10/pi-lsp</code
						>
					</div>
					<a href="#packages">open the package browser ↓</a>
				</div>
			</div>
		</section>

		<section
			id="packages"
			class="packages"
			aria-labelledby="packages-heading"
		>
			<header class="browser-bar">
				<div>
					<span class="browser-dot"></span>
					<strong>packages/</strong>
				</div>
				<span>18 direct-install extensions</span>
			</header>

			<div class="browser-intro">
				<div>
					<p class="comment">// reusable @spences10/pi-* packages</p>
					<h2 id="packages-heading">Build your own Pi setup.</h2>
				</div>
				<p>
					Every row opens its package README—the source of truth for
					commands, configuration, and runtime behavior.
				</p>
			</div>

			<div class="package-groups">
				{#each package_groups as group, group_index (group.label)}
					<section
						class:group-magenta={group_index === 1}
						class:group-green={group_index === 2}
					>
						<h3><span aria-hidden="true">./</span>{group.prompt}</h3>
						<p>{group.label}</p>
						<ul>
							{#each group.packages as [name, description] (name)}
								<li>
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
					<span aria-hidden="true">#</span> support dependencies — published,
					but not the direct-install menu
				</p>
				<div>
					{#each support_packages as name (name)}
						<code>@spences10/{name}</code>
					{/each}
				</div>
			</aside>
		</section>

		<section class="help" aria-labelledby="help-heading">
			<header>
				<p class="prompt-line">
					<span aria-hidden="true">$</span> my-pi --help
				</p>
				<h2 id="help-heading">Before you run it.</h2>
			</header>
			<div class="help-output">
				{#each faq_lines as [question, answer] (question)}
					<details>
						<summary
							><span aria-hidden="true">?</span>{question}<i
								aria-hidden="true">+</i
							></summary
						>
						<p>{answer}</p>
					</details>
				{/each}
			</div>
		</section>

		<section class="closing" aria-labelledby="closing-heading">
			<p class="comment">// quick start</p>
			<h2 id="closing-heading">
				Run the full setup. Or install only what you need.
			</h2>
			<div class="closing-line">
				<div class="command-line compact">
					<span aria-hidden="true">$</span><code
						>pnpx my-pi@latest</code
					>
				</div>
				<a href="https://github.com/spences10/my-pi">
					<GithubLogoIcon aria-hidden="true" /> read the source
				</a>
			</div>
		</section>
	</div>
</main>

<footer class="page-footer">
	<p><span>my-pi</span> / curated Pi coding-agent distribution</p>
	<nav aria-label="Footer">
		<a href="https://github.com/spences10/my-pi">GitHub</a>
		<a href="https://www.npmjs.com/package/my-pi">npm</a>
		<a href="#packages">packages</a>
	</nav>
</footer>

<style>
	:global(html) {
		scroll-behavior: smooth;
	}

	.logo-gradient {
		background: linear-gradient(
			90deg,
			var(--afterglow-terminal-green),
			var(--afterglow-terminal-yellow),
			var(--afterglow-terminal-magenta),
			var(--afterglow-terminal-blue)
		);
		background-clip: text;
		color: transparent;
		filter: drop-shadow(0 0 10px rgb(255 0 204 / 0.22));
	}

	.site-shell,
	.page-footer {
		--shell-border: color-mix(
			in srgb,
			var(--afterglow-border-variant) 76%,
			transparent
		);
		--shell-copy: color-mix(
			in srgb,
			var(--afterglow-text) 78%,
			transparent
		);

		width: min(74rem, calc(100% - 2.5rem));
		margin-inline: auto;
		font-family: var(--font-mono);
	}

	.site-shell {
		padding-bottom: clamp(5rem, 10vw, 9rem);
	}

	.manual,
	.install,
	.packages {
		border: 1px solid var(--shell-border);
		background: color-mix(
			in srgb,
			var(--afterglow-elevated-surface-background) 72%,
			transparent
		);
		box-shadow: 0 24px 80px rgb(0 0 0 / 0.22);
	}

	.manual-bar,
	.install-bar,
	.browser-bar,
	.manual-status {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		min-height: 2.5rem;
		padding: 0.65rem 1rem;
		border-bottom: 1px solid var(--shell-border);
		color: var(--afterglow-text-muted);
		font-size: 0.68rem;
		font-weight: 650;
		letter-spacing: 0.09em;
		text-transform: uppercase;
	}

	.manual-bar span:first-child,
	.manual-bar span:last-child {
		color: var(--afterglow-terminal-magenta);
	}

	.manual-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.14fr) minmax(20rem, 0.86fr);
	}

	.manual-copy,
	.tree {
		padding: clamp(2rem, 5vw, 4.5rem);
	}

	.manual-copy {
		border-right: 1px solid var(--shell-border);
	}

	.comment {
		margin: 0 0 1.25rem;
		color: var(--afterglow-text-muted);
		font-size: 0.72rem;
		font-style: italic;
	}

	h1,
	h2,
	h3,
	p {
		text-wrap: pretty;
	}

	h1,
	h2,
	h3 {
		font-family: var(--font-mono);
	}

	h1 {
		max-width: 13ch;
		margin: 0;
		font-size: clamp(2.35rem, 5vw, 4.7rem);
		font-weight: 760;
		line-height: 1.02;
		letter-spacing: -0.055em;
	}

	.lede {
		max-width: 54ch;
		margin: 2rem 0;
		color: var(--shell-copy);
		font-family: var(--font-sans);
		font-size: clamp(1rem, 1.8vw, 1.18rem);
		line-height: 1.75;
	}

	.command-line {
		display: flex;
		align-items: center;
		width: fit-content;
		max-width: 100%;
		border: 1px solid var(--afterglow-border);
		background: var(--afterglow-background);
		box-shadow: var(--afterglow-shadow-magenta);
	}

	.command-line span {
		align-self: stretch;
		padding: 0.9rem 0 0.9rem 1rem;
		color: var(--afterglow-terminal-magenta);
		font-weight: 800;
	}

	.command-line code {
		overflow-x: auto;
		padding: 0.9rem 1rem 0.9rem 0.75rem;
		color: var(--afterglow-terminal-green);
		font-size: clamp(0.78rem, 1.5vw, 0.92rem);
		font-weight: 700;
		white-space: nowrap;
	}

	.command-line.compact {
		box-shadow: none;
	}

	.source-links {
		display: flex;
		gap: 1.5rem;
		margin-top: 1.6rem;
	}

	.source-links a,
	.install a,
	.closing a {
		display: inline-flex;
		gap: 0.45rem;
		align-items: center;
		color: var(--afterglow-terminal-cyan);
		font-size: 0.76rem;
		font-weight: 700;
		text-decoration: none;
	}

	.source-links :global(svg),
	.closing :global(svg) {
		width: 1rem;
	}

	.tree {
		align-self: center;
		font-size: 0.78rem;
	}

	.tree > p {
		margin: 0 0 1rem;
		color: var(--afterglow-terminal-cyan);
		font-weight: 750;
	}

	.tree-note {
		margin-left: 0.4rem;
		color: var(--afterglow-text-muted);
		font-weight: 400;
	}

	.tree ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tree li {
		display: grid;
		grid-template-columns: 2.4rem 7.2rem 1fr;
		gap: 0.4rem;
		padding: 0.58rem 0;
		color: var(--afterglow-comment);
	}

	.tree strong {
		color: var(--afterglow-text);
		font-weight: 650;
	}

	.tree small {
		color: var(--afterglow-text-muted);
		font-size: inherit;
	}

	.tree-status {
		display: flex;
		gap: 0.55rem;
		align-items: center;
		margin-top: 1.5rem;
		color: var(--afterglow-text-muted);
		font-size: 0.68rem;
	}

	.tree-status i,
	.browser-dot {
		width: 0.48rem;
		height: 0.48rem;
		border-radius: 50%;
		background: var(--afterglow-terminal-green);
		box-shadow: 0 0 12px
			color-mix(
				in srgb,
				var(--afterglow-terminal-green) 75%,
				transparent
			);
	}

	.manual-status {
		border-top: 1px solid var(--shell-border);
		border-bottom: 0;
		background: var(--afterglow-background);
		color: var(--afterglow-terminal-magenta);
		text-transform: none;
	}

	.session,
	.stack,
	.help,
	.closing {
		padding-block: clamp(5.5rem, 11vw, 9rem);
	}

	.command-heading {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(18rem, 0.65fr);
		gap: clamp(2rem, 7vw, 7rem);
		align-items: end;
		margin-bottom: 2rem;
	}

	.command-heading > div {
		display: flex;
		gap: 0.8rem;
		align-items: baseline;
		min-width: 0;
	}

	.prompt {
		color: var(--afterglow-terminal-green);
		font-size: 1.3rem;
		font-weight: 800;
	}

	.command-heading h2,
	.help h2,
	.closing h2 {
		margin: 0;
		font-size: clamp(1.45rem, 3.3vw, 2.65rem);
		font-weight: 730;
		letter-spacing: -0.045em;
	}

	.command-heading p,
	.browser-intro > p {
		margin: 0;
		color: var(--shell-copy);
		font-family: var(--font-sans);
		font-size: 0.98rem;
		line-height: 1.7;
	}

	.terminal-caption {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin: 0 0 0.75rem;
		color: var(--afterglow-text-muted);
		font-size: 0.68rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.terminal-caption :global(svg) {
		width: 1rem;
	}

	.stack {
		border-top: 1px solid var(--shell-border);
	}

	.stack-output {
		margin: 0;
		padding: 0;
		border: 1px solid var(--shell-border);
		list-style: none;
		background: color-mix(
			in srgb,
			var(--afterglow-elevated-surface-background) 68%,
			transparent
		);
	}

	.stack-output li {
		display: grid;
		grid-template-columns: 1.5rem minmax(14rem, 0.7fr) 1.3fr;
		gap: clamp(1rem, 3vw, 3rem);
		align-items: start;
		padding: 1.5rem;
	}

	.stack-output li + li {
		border-top: 1px solid var(--shell-border);
	}

	.output-marker {
		color: var(--afterglow-terminal-magenta);
		font-weight: 900;
	}

	.output-title h3 {
		margin: 0 0 0.55rem;
		font-size: 1rem;
		font-weight: 720;
	}

	.output-title code {
		color: var(--afterglow-terminal-cyan);
		font-size: 0.66rem;
	}

	.stack-output li > p {
		margin: 0;
		color: var(--shell-copy);
		font-family: var(--font-sans);
		font-size: 0.94rem;
		line-height: 1.65;
	}

	.install {
		margin-block: clamp(1rem, 4vw, 4rem) clamp(6rem, 12vw, 10rem);
	}

	.install-bar span:first-child,
	.browser-bar strong {
		color: var(--afterglow-terminal-magenta);
	}

	.install-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
	}

	.install-grid > div {
		padding: clamp(2rem, 5vw, 4rem);
	}

	.install-grid > div + div {
		border-left: 1px solid var(--shell-border);
	}

	.install h2 {
		margin: 0;
		font-size: clamp(1.55rem, 3vw, 2.35rem);
		letter-spacing: -0.045em;
	}

	.install h2 + p {
		min-height: 5.2rem;
		margin: 1rem 0 1.75rem;
		color: var(--shell-copy);
		font-family: var(--font-sans);
		font-size: 0.94rem;
		line-height: 1.65;
	}

	.install small {
		display: block;
		margin-top: 1rem;
		color: var(--afterglow-text-muted);
		font-size: 0.66rem;
		line-height: 1.55;
	}

	.install > div a,
	.install-grid a {
		margin-top: 1rem;
	}

	.browser-bar {
		background: var(--afterglow-background);
	}

	.browser-bar > div {
		display: flex;
		gap: 0.6rem;
		align-items: center;
	}

	.browser-intro {
		display: grid;
		grid-template-columns: 1fr minmax(18rem, 0.55fr);
		gap: clamp(2rem, 7vw, 7rem);
		align-items: end;
		padding: clamp(2rem, 5vw, 4.5rem);
		border-bottom: 1px solid var(--shell-border);
	}

	.browser-intro h2 {
		max-width: 18ch;
		margin: 0;
		font-size: clamp(1.9rem, 4vw, 3.4rem);
		font-weight: 750;
		letter-spacing: -0.05em;
	}

	.package-groups > section {
		display: grid;
		grid-template-columns: minmax(10rem, 0.3fr) 1fr;
		padding: clamp(2rem, 4vw, 3.5rem);
	}

	.package-groups > section + section {
		border-top: 1px solid var(--shell-border);
	}

	.package-groups h3,
	.package-groups section > p {
		grid-column: 1;
	}

	.package-groups h3 {
		margin: 0;
		color: var(--afterglow-terminal-cyan);
		font-size: 0.78rem;
		font-weight: 700;
	}

	.package-groups .group-magenta h3 {
		color: var(--afterglow-terminal-magenta);
	}

	.package-groups .group-green h3 {
		color: var(--afterglow-terminal-green);
	}

	.package-groups section > p {
		margin: 0.55rem 0 0;
		color: var(--afterglow-text-muted);
		font-size: 0.66rem;
	}

	.package-groups ul {
		grid-column: 2;
		grid-row: 1 / span 2;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.package-groups li + li {
		border-top: 1px solid
			color-mix(in srgb, var(--shell-border) 65%, transparent);
	}

	.package-groups a {
		display: grid;
		grid-template-columns: minmax(14rem, 0.78fr) 1.22fr auto;
		gap: 1rem;
		align-items: center;
		padding: 0.9rem 0;
		color: inherit;
		text-decoration: none;
	}

	.package-groups a > code {
		font-size: 0.75rem;
		font-weight: 700;
	}

	.package-groups a > code span {
		color: var(--afterglow-text-muted);
		font-weight: 400;
	}

	.package-groups a > small {
		color: var(--shell-copy);
		font-family: var(--font-sans);
		font-size: 0.8rem;
		line-height: 1.45;
	}

	.package-groups a :global(svg) {
		width: 0.9rem;
		color: var(--afterglow-comment);
		transition:
			transform 150ms ease,
			color 150ms ease;
	}

	.package-groups a:hover > code,
	.package-groups a:focus-visible > code,
	.package-groups a:hover :global(svg),
	.package-groups a:focus-visible :global(svg) {
		color: var(--afterglow-terminal-cyan);
	}

	.package-groups a:hover :global(svg),
	.package-groups a:focus-visible :global(svg) {
		transform: translate(0.14rem, -0.14rem);
	}

	.support-packages {
		display: grid;
		grid-template-columns: minmax(14rem, 0.5fr) 1fr;
		gap: 2rem;
		padding: 1.2rem clamp(2rem, 4vw, 3.5rem);
		border-top: 1px solid var(--shell-border);
		background: var(--afterglow-background);
	}

	.support-packages p {
		margin: 0;
		color: var(--afterglow-text-muted);
		font-size: 0.64rem;
		line-height: 1.55;
	}

	.support-packages p span {
		color: var(--afterglow-terminal-magenta);
	}

	.support-packages div {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
	}

	.support-packages code {
		color: var(--afterglow-text-muted);
		font-size: 0.62rem;
	}

	.help {
		display: grid;
		grid-template-columns: minmax(13rem, 0.42fr) 1fr;
		gap: clamp(3rem, 8vw, 8rem);
	}

	.prompt-line {
		margin: 0 0 1.5rem;
		color: var(--afterglow-terminal-cyan);
		font-size: 0.72rem;
	}

	.prompt-line span {
		color: var(--afterglow-terminal-green);
		font-weight: 800;
	}

	.help-output {
		border-top: 1px solid var(--shell-border);
	}

	details {
		border-bottom: 1px solid var(--shell-border);
	}

	summary {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 0.8rem;
		align-items: center;
		padding: 1.25rem 0;
		font-size: 0.86rem;
		font-weight: 700;
		cursor: pointer;
		list-style: none;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	summary span,
	summary i {
		color: var(--afterglow-terminal-magenta);
		font-style: normal;
	}

	summary i {
		font-size: 1.1rem;
		transition: transform 150ms ease;
	}

	details[open] summary i {
		transform: rotate(45deg);
	}

	details p {
		max-width: 66ch;
		margin: -0.25rem 2rem 1.5rem;
		color: var(--shell-copy);
		font-family: var(--font-sans);
		font-size: 0.9rem;
		line-height: 1.7;
	}

	.closing {
		border-top: 1px solid var(--shell-border);
	}

	.closing h2 {
		font-size: clamp(2rem, 4vw, 3.7rem);
	}

	.closing-line {
		display: flex;
		flex-wrap: wrap;
		gap: 1.5rem 2rem;
		align-items: center;
		margin-top: 2rem;
	}

	.page-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 2rem;
		padding-block: 1.5rem 2.5rem;
		border-top: 1px solid var(--shell-border);
		color: var(--afterglow-comment);
		font-size: 0.65rem;
	}

	.page-footer p {
		margin: 0;
	}

	.page-footer p span {
		color: var(--afterglow-text);
	}

	.page-footer nav {
		display: flex;
		gap: 1.4rem;
	}

	.page-footer a {
		color: inherit;
		text-decoration: none;
	}

	.source-links a:hover,
	.source-links a:focus-visible,
	.install a:hover,
	.install a:focus-visible,
	.closing a:hover,
	.closing a:focus-visible,
	.page-footer a:hover,
	.page-footer a:focus-visible {
		color: var(--afterglow-terminal-magenta);
	}

	@media (max-width: 860px) {
		.manual-grid,
		.command-heading,
		.install-grid,
		.browser-intro,
		.help {
			grid-template-columns: 1fr;
		}

		.manual-copy {
			border-right: 0;
			border-bottom: 1px solid var(--shell-border);
		}

		.command-heading {
			gap: 1.4rem;
		}

		.stack-output li {
			grid-template-columns: 1.5rem 1fr;
		}

		.stack-output li > p {
			grid-column: 2;
		}

		.install-grid > div + div {
			border-top: 1px solid var(--shell-border);
			border-left: 0;
		}

		.install h2 + p {
			min-height: 0;
		}

		.package-groups > section {
			grid-template-columns: 1fr;
		}

		.package-groups ul {
			grid-column: 1;
			grid-row: auto;
			margin-top: 1.25rem;
		}

		.support-packages {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 580px) {
		.site-shell,
		.page-footer {
			width: min(100% - 1.25rem, 74rem);
		}

		.manual-bar span:nth-child(2),
		.manual-status span:nth-child(2),
		.browser-bar > span {
			display: none;
		}

		.manual-copy,
		.tree,
		.install-grid > div,
		.browser-intro,
		.package-groups > section {
			padding: 1.5rem;
		}

		h1 {
			font-size: clamp(2rem, 12vw, 3.35rem);
		}

		.tree li {
			grid-template-columns: 2rem 1fr;
		}

		.tree small {
			grid-column: 2;
			padding-bottom: 0.25rem;
		}

		.command-heading > div {
			align-items: flex-start;
		}

		.command-heading h2 {
			overflow-wrap: anywhere;
		}

		.stack-output li {
			padding: 1.2rem 1rem;
		}

		.output-title code {
			display: block;
			overflow-wrap: anywhere;
			line-height: 1.6;
		}

		.package-groups a {
			grid-template-columns: 1fr auto;
			gap: 0.5rem;
			padding: 1rem 0;
		}

		.package-groups a > code {
			overflow-wrap: anywhere;
		}

		.package-groups a > small {
			grid-column: 1 / -1;
			grid-row: 2;
		}

		.support-packages {
			padding-inline: 1.5rem;
		}

		.page-footer {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
