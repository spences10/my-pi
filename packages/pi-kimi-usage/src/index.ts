import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const STATUS_KEY = 'kimi-usage';
const KIMI_PROVIDER = 'kimi-coding';
const KIMI_USAGE_URL = 'https://api.kimi.com/coding/v1/usages';
const KIMI_USER_AGENT = 'KimiCLI/1.6';
const FETCH_INTERVAL_MS = 5 * 60 * 1000;
const TURN_REFRESH_DEBOUNCE_MS = 60 * 1000;

export interface KimiUsageWindow {
	usedPercent: number;
	resetAtSeconds?: number;
}

export interface KimiUsageSnapshot {
	membershipLevel?: string;
	primary: KimiUsageWindow;
	secondary?: KimiUsageWindow;
}

type KimiUsageTone = 'dim' | 'warning' | 'error';

export function is_kimi_provider(
	provider: string | undefined,
): boolean {
	return provider === KIMI_PROVIDER;
}

function read_record(
	value: unknown,
): Record<string, unknown> | undefined {
	return value && typeof value === 'object'
		? (value as Record<string, unknown>)
		: undefined;
}

function read_string(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim()
		? value
		: undefined;
}

/** Kimi returns quota numbers as strings ("100", "4"); accept numbers too. */
function read_amount(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value))
		return value;
	if (typeof value === 'string') {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

function read_reset_seconds(value: unknown): number | undefined {
	const text = read_string(value);
	if (!text) return undefined;
	const ms = Date.parse(text);
	return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

function window_seconds(window: unknown): number | undefined {
	const record = read_record(window);
	const duration = read_amount(record?.duration);
	const unit = read_string(record?.timeUnit);
	if (duration === undefined || !unit) return undefined;
	if (unit.includes('MINUTE')) return duration * 60;
	if (unit.includes('HOUR')) return duration * 60 * 60;
	if (unit.includes('DAY')) return duration * 24 * 60 * 60;
	if (unit.includes('MONTH')) return duration * 30 * 24 * 60 * 60;
	return duration;
}

function parse_window(detail: unknown): KimiUsageWindow | undefined {
	const record = read_record(detail);
	const limit = read_amount(record?.limit);
	const used = read_amount(record?.used);
	if (!limit || used === undefined) return undefined;
	return {
		usedPercent: Math.round((used / limit) * 1000) / 10,
		resetAtSeconds: read_reset_seconds(record?.resetTime),
	};
}

export function parse_kimi_usage_response(
	payload: unknown,
): KimiUsageSnapshot | null {
	const root = read_record(payload);
	const weekly = parse_window(root?.usage);
	if (!weekly) return null;

	const limits = Array.isArray(root?.limits) ? root.limits : [];
	const windows: { window: KimiUsageWindow; seconds?: number }[] = [];
	for (const entry of limits) {
		const record = read_record(entry);
		const window = parse_window(record?.detail);
		if (!window) continue;
		windows.push({ window, seconds: window_seconds(record?.window) });
	}
	windows.sort(
		(a, b) => (a.seconds ?? Infinity) - (b.seconds ?? Infinity),
	);

	const membership = read_record(root?.user)?.membership;
	const level = read_string(read_record(membership)?.level);

	// Shortest rolling window (5h) is primary, weekly quota secondary.
	const primary = windows[0]?.window ?? weekly;
	const secondary = windows.length > 0 ? weekly : undefined;

	return {
		membershipLevel: level?.replace(/^LEVEL_/, '').toLowerCase(),
		primary,
		secondary,
	};
}

function compact_reset(
	resetAtSeconds: number | undefined,
	nowMs: number,
): string {
	if (!resetAtSeconds) return '';
	const remaining_ms = resetAtSeconds * 1000 - nowMs;
	if (remaining_ms <= 0) return 'now';
	const hours = Math.ceil(remaining_ms / (60 * 60 * 1000));
	if (hours < 24) return `${hours}h`;
	return `${Math.ceil(hours / 24)}d`;
}

function percent(value: number): string {
	return `${Math.round(value)}%`;
}

function format_window(
	window: KimiUsageWindow,
	nowMs: number,
): string {
	const reset = compact_reset(window.resetAtSeconds, nowMs);
	return reset
		? `${reset} ${percent(window.usedPercent)}`
		: percent(window.usedPercent);
}

export function format_kimi_usage_status(
	snapshot: KimiUsageSnapshot,
	nowMs = Date.now(),
): string {
	const parts = [`kimi ${format_window(snapshot.primary, nowMs)}`];
	if (snapshot.secondary) {
		parts.push(format_window(snapshot.secondary, nowMs));
	}
	return parts.join(' · ');
}

export function get_kimi_usage_tone(
	snapshot: KimiUsageSnapshot,
): KimiUsageTone {
	const max_used = Math.max(
		snapshot.primary.usedPercent,
		snapshot.secondary?.usedPercent ?? 0,
	);
	if (max_used >= 100) return 'error';
	if (max_used >= 80) return 'warning';
	return 'dim';
}

export async function read_kimi_credential(
	authPath = join(homedir(), '.pi', 'agent', 'auth.json'),
	env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
	try {
		const auth = JSON.parse(
			await readFile(authPath, 'utf8'),
		) as unknown;
		const entry = read_record(read_record(auth)?.[KIMI_PROVIDER]);
		// OAuth login: { type: "oauth", access, refresh, expires }
		// API key login: { type: "api_key", key }
		const key = read_string(entry?.key) ?? read_string(entry?.access);
		if (key) return key;
	} catch {
		// Fall through to the environment variable.
	}
	return read_string(env.KIMI_API_KEY) ?? null;
}

function active_provider(ctx: ExtensionContext): string | undefined {
	return (ctx as ExtensionContext & { model?: { provider?: string } })
		.model?.provider;
}

function themed(
	ctx: ExtensionContext,
	tone: KimiUsageTone,
	text: string,
): string {
	const theme = (
		ctx.ui as {
			theme?: { fg?: (tone: string, text: string) => string };
		}
	).theme;
	return theme?.fg ? theme.fg(tone, text) : text;
}

async function fetch_kimi_usage(): Promise<KimiUsageSnapshot | null> {
	const token = await read_kimi_credential();
	if (!token) return null;

	const response = await fetch(KIMI_USAGE_URL, {
		headers: {
			Accept: 'application/json',
			Authorization: `Bearer ${token}`,
			'User-Agent': KIMI_USER_AGENT,
		},
	});
	if (!response.ok)
		throw new Error(`Kimi usage failed: ${response.status}`);
	return parse_kimi_usage_response(await response.json());
}

export default async function kimi_usage(pi: ExtensionAPI) {
	let interval: NodeJS.Timeout | undefined;
	let last_turn_refresh = 0;

	function stop_interval() {
		if (!interval) return;
		clearInterval(interval);
		interval = undefined;
	}

	async function publish(ctx: ExtensionContext) {
		if (!ctx.hasUI || !is_kimi_provider(active_provider(ctx))) {
			stop_interval();
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}

		try {
			const snapshot = await fetch_kimi_usage();
			const text = snapshot
				? format_kimi_usage_status(snapshot)
				: undefined;
			ctx.ui.setStatus(
				STATUS_KEY,
				snapshot
					? themed(ctx, get_kimi_usage_tone(snapshot), text!)
					: undefined,
			);
		} catch {
			ctx.ui.setStatus(STATUS_KEY, themed(ctx, 'dim', 'kimi ?'));
		}

		if (interval) return;
		interval = setInterval(
			() => void publish(ctx),
			FETCH_INTERVAL_MS,
		);
	}

	pi.on('session_start', async (_event, ctx) => {
		await publish(ctx);
	});

	pi.on('model_select', async (_event, ctx) => {
		stop_interval();
		await publish(ctx);
	});

	pi.on('turn_end', async (_event, ctx) => {
		const now = Date.now();
		if (now - last_turn_refresh < TURN_REFRESH_DEBOUNCE_MS) return;
		last_turn_refresh = now;
		await publish(ctx);
	});

	pi.on('after_provider_response', async (event, ctx) => {
		if ((event as { status?: number }).status === 429)
			await publish(ctx);
	});

	pi.on('session_shutdown', async (_event, ctx) => {
		stop_interval();
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}
