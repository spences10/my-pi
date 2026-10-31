class Resource<T> {
	data = $state.raw<T | null>(null);
	error = $state<string | null>(null);
	loading = $state(true);
}

/**
 * Loads data in an effect and reloads when any state the loader reads
 * before its first await changes (range, live revision, ids). Call
 * during component setup. The last data stays while a reload runs, so
 * views do not flash.
 */
export function resource<T>(load: () => Promise<T>): Resource<T> {
	const state = new Resource<T>();

	$effect(() => {
		let cancelled = false;
		state.loading = true;
		load()
			.then((data) => {
				if (cancelled) return;
				state.data = data;
				state.error = null;
			})
			.catch((caught: unknown) => {
				if (cancelled) return;
				state.error =
					caught instanceof Error ? caught.message : String(caught);
			})
			.finally(() => {
				if (!cancelled) state.loading = false;
			});
		return () => {
			cancelled = true;
		};
	});

	return state;
}
