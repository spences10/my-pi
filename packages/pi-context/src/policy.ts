import type { ContextRetentionPolicy } from './types.js';

export const DEFAULT_CONTEXT_RETENTION_DAYS = 7;

export function parse_context_retention_policy(
	env: NodeJS.ProcessEnv = process.env,
): ContextRetentionPolicy {
	const retention_days = parse_optional_positive_number(
		env.MY_PI_CONTEXT_RETENTION_DAYS,
		DEFAULT_CONTEXT_RETENTION_DAYS,
	);
	const max_mb = parse_optional_positive_number(
		env.MY_PI_CONTEXT_MAX_MB,
		null,
	);
	return {
		retention_days,
		purge_on_shutdown: parse_boolean_env(
			env.MY_PI_CONTEXT_PURGE_ON_SHUTDOWN,
		),
		max_mb,
		max_bytes: max_mb === null ? null : max_mb * 1024 * 1024,
	};
}

function parse_optional_positive_number(
	value: string | undefined,
	fallback: number | null,
): number | null {
	if (value === undefined || value.trim() === '') return fallback;
	const normalized = value.trim().toLowerCase();
	if (
		normalized === '0' ||
		normalized === 'off' ||
		normalized === 'false' ||
		normalized === 'none' ||
		normalized === 'disabled'
	)
		return null;
	const parsed = Number(normalized);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parse_boolean_env(value: string | undefined): boolean {
	if (!value) return false;
	return ['1', 'true', 'yes', 'on'].includes(
		value.trim().toLowerCase(),
	);
}
