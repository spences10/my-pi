export type RangeKey = '24h' | '7d' | '14d' | 'all';

export const RANGES: {
	key: RangeKey;
	label: string;
	ms: number | null;
}[] = [
	{ key: '24h', label: 'Last 24 hours', ms: 86_400_000 },
	{ key: '7d', label: 'Last 7 days', ms: 7 * 86_400_000 },
	{ key: '14d', label: 'Last 14 days', ms: 14 * 86_400_000 },
	{ key: 'all', label: 'All retained', ms: null },
];

const storage_key = 'pi-observability-range';

function read_range(): RangeKey {
	try {
		const stored = localStorage.getItem(storage_key);
		if (RANGES.some((range) => range.key === stored))
			return stored as RangeKey;
	} catch {
		// Fall through to the default.
	}
	return '7d';
}

/** One time range shared by every view that aggregates. */
class Range {
	key = $state<RangeKey>(read_range());
	label = $derived(
		RANGES.find((range) => range.key === this.key)?.label ?? '',
	);

	set(key: RangeKey): void {
		this.key = key;
		try {
			localStorage.setItem(storage_key, key);
		} catch {
			// The choice still applies for this page.
		}
	}

	/** ISO start of the range, computed at call time. */
	since(): string | null {
		const ms = RANGES.find((range) => range.key === this.key)?.ms;
		return ms ? new Date(Date.now() - ms).toISOString() : null;
	}
}

export const range = new Range();
