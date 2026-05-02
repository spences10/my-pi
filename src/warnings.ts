const SQLITE_EXPERIMENTAL_WARNING =
	'SQLite is an experimental feature';
const FILTER_INSTALLED = Symbol.for(
	'my-pi.sqlite-warning-filter-installed',
);
const ORIGINAL_EMIT_WARNING = Symbol.for(
	'my-pi.original-emit-warning',
);

type WarningEmitter = Pick<typeof process, 'emitWarning'> & {
	[FILTER_INSTALLED]?: boolean;
	[ORIGINAL_EMIT_WARNING]?: typeof process.emitWarning;
};

export function should_suppress_warning(warning: Error): boolean {
	return (
		warning.name === 'ExperimentalWarning' &&
		warning.message.includes(SQLITE_EXPERIMENTAL_WARNING)
	);
}

function should_suppress_emit_warning_args(args: unknown[]): boolean {
	const [warning, options_or_type] = args;
	if (warning instanceof Error)
		return should_suppress_warning(warning);
	const warning_type =
		typeof options_or_type === 'string'
			? options_or_type
			: options_or_type && typeof options_or_type === 'object'
				? (options_or_type as { type?: unknown }).type
				: undefined;
	return (
		warning_type === 'ExperimentalWarning' &&
		String(warning).includes(SQLITE_EXPERIMENTAL_WARNING)
	);
}

export function install_sqlite_warning_filter(
	process_like: WarningEmitter = process,
): void {
	if (process_like[FILTER_INSTALLED]) return;
	process_like[FILTER_INSTALLED] = true;

	const original_emit_warning =
		process_like[ORIGINAL_EMIT_WARNING] ?? process_like.emitWarning;
	process_like[ORIGINAL_EMIT_WARNING] = original_emit_warning;

	process_like.emitWarning = function emit_filtered_warning(
		this: WarningEmitter,
		...args: unknown[]
	) {
		if (should_suppress_emit_warning_args(args)) return;
		return (
			original_emit_warning as (...args: unknown[]) => void
		).apply(this, args);
	} as typeof process.emitWarning;
}
