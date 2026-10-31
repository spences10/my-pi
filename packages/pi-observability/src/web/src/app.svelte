<script lang="ts">
	import { has_token } from '#lib/api.js';
	import AppSidebar from '#lib/components/app-sidebar.svelte';
	import CommandPalette from '#lib/components/command-palette.svelte';
	import LiveIndicator from '#lib/components/live-indicator.svelte';
	import RangeSelect from '#lib/components/range-select.svelte';
	import ThemeToggle from '#lib/components/theme-toggle.svelte';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import { live } from '#lib/live.svelte.js';
	import { recent_sessions } from '#lib/recent-sessions.svelte.js';
	import { router } from '#lib/router.svelte.js';
	import OverviewView from '#lib/views/overview-view.svelte';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import { onMount } from 'svelte';

	const load_sessions_view = () =>
		import('#lib/views/sessions-view.svelte');
	const load_tools_view = () =>
		import('#lib/views/tools-view.svelte');
	const load_session_view = () =>
		import('#lib/views/session-view.svelte');

	const titles = {
		overview: 'Overview',
		sessions: 'Sessions',
		tools: 'Tools',
		session: 'Session',
	} as const;

	const route = $derived(router.route);

	onMount(() => {
		void recent_sessions.load();
		const stop_refresh = live.on_refresh(
			() => void recent_sessions.load(),
		);
		const disconnect = live.connect();
		return () => {
			stop_refresh();
			disconnect();
		};
	});
</script>

<svelte:head
	><title>{titles[route.name]} · π observability</title></svelte:head
>
<svelte:window onpopstate={router.sync} />
<svelte:document onclick={router.handle_click} />

<Tooltip.Provider>
	{#if !has_token()}
		<Empty.Root class="min-h-svh">
			<Empty.Header>
				<Empty.Media variant="icon"><KeyRoundIcon /></Empty.Media>
				<Empty.Title
					>Open the link from <code>/observability</code></Empty.Title
				>
				<Empty.Description>
					This page needs the access token in the link that Pi prints.
					Run
					<code class="font-mono">/observability url</code> in a Pi session
					to get it again.
				</Empty.Description>
			</Empty.Header>
		</Empty.Root>
	{:else}
		<Sidebar.Provider>
			<AppSidebar />
			<Sidebar.Inset>
				<header
					class="sticky top-0 z-10 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur"
				>
					<Sidebar.Trigger class="-ml-1" />
					<Separator
						orientation="vertical"
						class="mx-1 hidden sm:block data-vertical:h-4"
					/>
					<h1 class="hidden text-sm font-medium sm:block">
						{titles[route.name]}
					</h1>
					<div class="ml-2 min-w-0 flex-1">
						<CommandPalette />
					</div>
					<div class="flex shrink-0 items-center gap-1 sm:gap-2">
						{#if route.name !== 'session'}
							<RangeSelect />
						{/if}
						<LiveIndicator />
						<ThemeToggle />
					</div>
				</header>

				<main
					class="mx-auto w-full max-w-384 min-w-0 flex-1 p-4 md:p-6"
				>
					{#if route.name === 'overview'}
						<OverviewView />
					{:else if route.name === 'sessions'}
						{#await load_sessions_view() then module}
							<module.default />
						{/await}
					{:else if route.name === 'tools'}
						{#await load_tools_view() then module}
							<module.default />
						{/await}
					{:else}
						{#await load_session_view() then module}
							{#key route.id}
								<module.default
									id={route.id}
									tab={route.tab}
									span={route.span}
								/>
							{/key}
						{/await}
					{/if}
				</main>
			</Sidebar.Inset>
		</Sidebar.Provider>
	{/if}
</Tooltip.Provider>
