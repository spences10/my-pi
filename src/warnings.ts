const SQLITE_EXPERIMENTAL_WARNING =
	'SQLite is an experimental feature';
const FILTER_INSTALLED = Symbol.for(
	'my-pi.sqlite-warning-filter-installed',
);

export function should_suppress_warning(warning: Error): boolean {
	return (
		warning.name === 'ExperimentalWarning' &&
		warning.message.includes(SQLITE_EXPERIMENTAL_WARNING)
	);
}

export function install_sqlite_warning_filter(
	process_like: typeof process = process,
): void {
	const state = process_like as typeof process & {
		[FILTER_INSTALLED]?: boolean;
	};
	if (state[FILTER_INSTALLED]) return;
	state[FILTER_INSTALLED] = true;

	process_like.on('warning', (warning) => {
		if (should_suppress_warning(warning)) return;
		console.warn(warning);
	});
}
