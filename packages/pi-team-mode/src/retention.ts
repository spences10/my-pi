export const TEAM_RETENTION_DAYS_ENV = 'MY_PI_TEAM_RETENTION_DAYS';
export const DEFAULT_COORDINATION_RETENTION_MS =
	30 * 24 * 60 * 60 * 1000;

export function get_coordination_retention_ms(): number | undefined {
	const configured = process.env[TEAM_RETENTION_DAYS_ENV]?.trim();
	if (!configured) return DEFAULT_COORDINATION_RETENTION_MS;
	if (
		['0', 'off', 'false', 'disabled'].includes(
			configured.toLowerCase(),
		)
	)
		return undefined;
	const days = Number(configured);
	if (!Number.isFinite(days) || days <= 0)
		return DEFAULT_COORDINATION_RETENTION_MS;
	return days * 24 * 60 * 60 * 1000;
}
