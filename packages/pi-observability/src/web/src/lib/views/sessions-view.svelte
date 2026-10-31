<script lang="ts">
	import { api } from '#lib/api.js';
	import SessionsTable from '#lib/components/sessions-table.svelte';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { money, repo_name, session_title } from '#lib/format.js';
	import { live } from '#lib/live.svelte.js';
	import { range } from '#lib/range.svelte.js';
	import { resource } from '#lib/resource.svelte.js';
	import SearchIcon from '@lucide/svelte/icons/search';

	const ALL = '__all__';

	let query = $state('');
	let project = $state(ALL);

	const sessions = resource(() => {
		void live.revision;
		return api.session_stats(range.since());
	});

	const projects = $derived(
		[
			...new Set((sessions.data?.sessions ?? []).map(repo_name)),
		].sort(),
	);

	const visible = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		return (sessions.data?.sessions ?? []).filter(
			(session) =>
				(project === ALL || repo_name(session) === project) &&
				(!needle ||
					[
						session_title(session),
						session.session_id,
						session.cwd,
						session.model ?? '',
					]
						.join(' ')
						.toLowerCase()
						.includes(needle)),
		);
	});

	const visible_cost = $derived(
		visible.reduce((sum, session) => sum + session.cost_usd, 0),
	);
</script>

<div class="grid gap-4">
	{#if sessions.error}
		<Alert.Root variant="destructive">
			<Alert.Title>Could not load sessions</Alert.Title>
			<Alert.Description>{sessions.error}</Alert.Description>
		</Alert.Root>
	{/if}

	<div class="flex flex-wrap items-center gap-2">
		<div class="relative w-full max-w-sm">
			<SearchIcon
				class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
			/>
			<Input
				bind:value={query}
				placeholder="Search by name, id, path, or model"
				aria-label="Search sessions"
				class="pl-8"
			/>
		</div>
		<Select.Root type="single" bind:value={project}>
			<Select.Trigger class="w-48" aria-label="Project">
				{project === ALL ? 'All projects' : project}
			</Select.Trigger>
			<Select.Content>
				<Select.Item value={ALL} label="All projects" />
				{#each projects as name (name)}
					<Select.Item value={name} label={name} />
				{/each}
			</Select.Content>
		</Select.Root>
		<p class="ml-auto text-sm text-muted-foreground">
			{visible.length} sessions · {money(visible_cost)}
		</p>
	</div>

	<Card.Root
		class={[
			'py-0 transition-opacity',
			sessions.loading && sessions.data && 'opacity-70',
		]}
	>
		<Card.Content class="px-0">
			{#if !sessions.data}
				<div class="grid gap-2 p-4">
					{#each { length: 8 } as _, index (index)}
						<Skeleton class="h-10" />
					{/each}
				</div>
			{:else}
				<SessionsTable sessions={visible} />
			{/if}
		</Card.Content>
	</Card.Root>
</div>
