import type { DashboardSession } from '../../../types';
import { number_crunch } from './number-crunch.js';

export { number_crunch };

export function money(value: number | null | undefined): string {
	if (!value) return '$0';
	if (value < 0.01) return '<$0.01';
	if (value < 100) return `$${value.toFixed(2)}`;
	return `$${number_crunch(value)}`;
}

export function duration(ms: number | null | undefined): string {
	if (ms == null) return '—';
	if (ms === 0) return '0';
	if (ms < 1) return '<1ms';
	if (ms < 1_000) return `${Math.round(ms)}ms`;
	if (ms < 60_000)
		return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)}s`;
	const minutes = Math.floor(ms / 60_000);
	if (minutes < 60)
		return `${minutes}m ${Math.round((ms % 60_000) / 1_000)}s`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function percent(part: number, whole: number): string {
	if (!whole) return '0%';
	const value = (part / whole) * 100;
	return `${value < 10 ? value.toFixed(1) : Math.round(value)}%`;
}

export function clock(value: string | null | undefined): string {
	if (!value) return '—';
	const date = new Date(value);
	return Number.isNaN(date.valueOf())
		? value
		: date.toLocaleTimeString([], {
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit',
			});
}

export function date_time(value: string | null | undefined): string {
	if (!value) return '—';
	const date = new Date(value);
	return Number.isNaN(date.valueOf())
		? value
		: date.toLocaleString([], {
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
			});
}

export function relative_time(
	value: string | null | undefined,
	now = Date.now(),
): string {
	if (!value) return '—';
	const elapsed = now - Date.parse(value);
	if (Number.isNaN(elapsed)) return value;
	if (elapsed < 60_000) return 'just now';
	if (elapsed < 3_600_000)
		return `${Math.floor(elapsed / 60_000)}m ago`;
	if (elapsed < 86_400_000)
		return `${Math.floor(elapsed / 3_600_000)}h ago`;
	return `${Math.floor(elapsed / 86_400_000)}d ago`;
}

/** Short day label for a YYYY-MM-DD local day. */
export function day_label(day: string): string {
	const [year, month, date] = day.split('-').map(Number);
	return new Date(year!, month! - 1, date!).toLocaleDateString([], {
		month: 'short',
		day: 'numeric',
	});
}

export function repo_name(
	session: Pick<DashboardSession, 'cwd'>,
): string {
	const cwd = session.cwd || 'unknown project';
	return (
		cwd.replace(/\/+$/, '').split('/').filter(Boolean).pop() || cwd
	);
}

export function short_id(id: string): string {
	return id.length > 8 ? id.slice(0, 8) : id;
}

export function session_title(session: {
	session_id: string;
	session_name?: string | null;
	agent_name?: string | null;
}): string {
	return (
		session.session_name ||
		session.agent_name ||
		short_id(session.session_id)
	);
}

/** A ratio with one decimal under 10: 1.4, 46. */
export function ratio(part: number, whole: number): string {
	if (!whole) return '0';
	const value = part / whole;
	return value < 10
		? value.toFixed(1).replace(/\.0$/, '')
		: number_crunch(value);
}

/** mcp__server__tool -> server › tool; other names unchanged. */
export function tool_label(name: string): string {
	const match = /^mcp__(.+?)__(.+)$/.exec(name);
	return match ? `${match[1]} › ${match[2]}` : name;
}

function local_day(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Adds zero rows for days with no activity, from `since` (or the first
 * row) to today, so the time axis has no gaps.
 */
export function fill_days<T extends { day: string }>(
	rows: T[],
	since: string | null,
	empty: (day: string) => T,
): T[] {
	const first = since ? local_day(new Date(since)) : rows[0]?.day;
	if (!first) return rows;
	const by_day = new Map(rows.map((row) => [row.day, row]));
	const [year, month, date] = first.split('-').map(Number);
	const cursor = new Date(year!, month! - 1, date!);
	const today = local_day(new Date());
	const filled: T[] = [];
	for (let guard = 0; guard < 400; guard += 1) {
		const day = local_day(cursor);
		filled.push(by_day.get(day) ?? empty(day));
		if (day >= today) break;
		cursor.setDate(cursor.getDate() + 1);
	}
	return filled;
}
