<script lang="ts">
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import {
		relative_time,
		repo_name,
		session_title,
	} from '#lib/format.js';
	import { live } from '#lib/live.svelte.js';
	import { recent_sessions } from '#lib/recent-sessions.svelte.js';
	import { href, session_href } from '#lib/router.js';
	import { router } from '#lib/router.svelte.js';
	import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
	import ListIcon from '@lucide/svelte/icons/list';
	import WrenchIcon from '@lucide/svelte/icons/wrench';

	let filter = $state('');

	const nav = [
		{
			name: 'overview',
			label: 'Overview',
			icon: LayoutDashboardIcon,
		},
		{ name: 'sessions', label: 'Sessions', icon: ListIcon },
		{ name: 'tools', label: 'Tools', icon: WrenchIcon },
	] as const;

	const active_id = $derived(
		router.route.name === 'session' ? router.route.id : null,
	);

	const sessions = $derived.by(() => {
		const needle = filter.trim().toLowerCase();
		return recent_sessions.list
			.filter(
				(session) =>
					!needle ||
					[
						session_title(session),
						repo_name(session),
						session.session_id,
						session.model ?? '',
					]
						.join(' ')
						.toLowerCase()
						.includes(needle),
			)
			.toSorted(
				(a, b) =>
					Number(live.is_active(b.session_id, b.last_ts)) -
						Number(live.is_active(a.session_id, a.last_ts)) ||
					b.last_ts.localeCompare(a.last_ts),
			)
			.slice(0, 40);
	});
</script>

<Sidebar.Root>
	<Sidebar.Header>
		<a href="/" class="flex items-baseline gap-2 px-2 pt-1">
			<span
				class="text-lg font-bold tracking-tight font-stretch-112%"
			>
				π observability
			</span>
		</a>
	</Sidebar.Header>
	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					{#each nav as item (item.name)}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton
								isActive={router.route.name === item.name}
							>
								{#snippet child({ props })}
									<a href={href({ name: item.name })} {...props}>
										<item.icon />
										<span>{item.label}</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/each}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
		<Sidebar.Group class="min-h-0 flex-1">
			<Sidebar.GroupLabel>Recent sessions</Sidebar.GroupLabel>
			<Sidebar.Input
				bind:value={filter}
				name="session-filter"
				placeholder="Filter sessions"
				aria-label="Filter sessions"
				class="mb-2"
			/>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					{#each sessions as session (session.session_id)}
						{@const active = live.is_active(
							session.session_id,
							session.last_ts,
						)}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton
								isActive={active_id === session.session_id}
								class="h-auto py-1.5"
							>
								{#snippet child({ props })}
									<a
										href={session_href(session.session_id)}
										{...props}
									>
										<span
											class={[
												'mt-1.5 size-1.5 shrink-0 self-start rounded-full',
												active ? 'bg-success' : 'bg-transparent',
											]}
											aria-hidden="true"
										></span>
										<span class="grid min-w-0 flex-1 leading-tight">
											<span class="truncate">
												{session_title(session)}
											</span>
											<span
												class="truncate text-xs text-muted-foreground"
											>
												{repo_name(session)} · {active
													? 'live'
													: relative_time(session.last_ts, live.now)}
											</span>
										</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{:else}
						<p class="px-2 py-1 text-sm text-muted-foreground">
							{filter
								? 'No sessions match.'
								: 'No sessions recorded yet.'}
						</p>
					{/each}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>
</Sidebar.Root>
