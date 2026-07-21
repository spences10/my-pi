export const TEAM_RETENTION_DAYS_ENV = 'MY_PI_TEAM_RETENTION_DAYS';
export const DEFAULT_MANUAL_COORDINATION_RETENTION_MS =
	30 * 24 * 60 * 60 * 1000;

export function get_startup_coordination_retention_ms():
	| number
	| undefined {
	const configured = process.env[TEAM_RETENTION_DAYS_ENV]?.trim();
	if (!configured) return undefined;
	if (
		['0', 'off', 'false', 'disabled'].includes(
			configured.toLowerCase(),
		)
	)
		return undefined;
	const days = Number(configured);
	if (!Number.isFinite(days) || days <= 0) return undefined;
	const retention_ms = days * 24 * 60 * 60 * 1000;
	return Number.isFinite(retention_ms) ? retention_ms : undefined;
}
