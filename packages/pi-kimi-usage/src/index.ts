import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as v from 'valibot';

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

type JsonValue =
	| null
	| string
	| number
	| boolean
	| JsonValue[]
	| { [key: string]: JsonValue };

const text_schema = v.fallback(
	v.optional(
		v.pipe(
			v.string(),
			v.check((text) => text.trim() !== ''),
		),
	),
	undefined,
);

/** Kimi returns quota numbers as strings ("100", "4"); accept numbers too. */
const amount_schema = v.fallback(
	v.optional(
		v.union([
			v.pipe(v.number(), v.finite()),
			v.pipe(v.string(), v.transform(Number), v.finite()),
		]),
	),
	undefined,
);

const reset_seconds_schema = v.fallback(
	v.optional(
		v.pipe(
			v.string(),
			v.check((text) => text.trim() !== ''),
			v.transform(Date.parse),
			v.finite(),
			v.transform((ms) => Math.floor(ms / 1000)),
		),
	),
	undefined,
);

const detail_schema = v.fallback(
	v.optional(
		v.object({
			limit: amount_schema,
			used: amount_schema,
			resetTime: reset_seconds_schema,
		}),
	),
	undefined,
);

const usage_payload_schema = v.fallback(
	v.object({
		usage: detail_schema,
		limits: v.fallback(
			v.array(
				v.fallback(
					v.object({
						window: v.fallback(
							v.optional(
								v.object({
									duration: amount_schema,
									timeUnit: text_schema,
								}),
							),
							undefined,
						),
						detail: detail_schema,
					}),
					{ window: undefined, detail: undefined },
				),
			),
			[],
		),
		user: v.fallback(
			v.optional(
				v.object({
					membership: v.fallback(
						v.optional(v.object({ level: text_schema })),
						undefined,
					),
				}),
			),
			undefined,
		),
	}),
	{ usage: undefined, limits: [], user: undefined },
);

type UsagePayload = v.InferOutput<typeof usage_payload_schema>;

type UsageWindowInput = UsagePayload['limits'][number]['window'];

type UsageDetail = UsagePayload['usage'];

function window_seconds(
	window: UsageWindowInput,
): number | undefined {
	const duration = window?.duration;
	const unit = window?.timeUnit;

	if (duration === undefined || !unit) return undefined;

	if (unit.includes('MINUTE')) return duration * 60;

	if (unit.includes('HOUR')) return duration * 60 * 60;

	if (unit.includes('DAY')) return duration * 24 * 60 * 60;

	if (unit.includes('MONTH')) return duration * 30 * 24 * 60 * 60;

	return duration;
}

function parse_window(
	detail: UsageDetail,
): KimiUsageWindow | undefined {
	const limit = detail?.limit;
	const used = detail?.used;

	if (!limit || used === undefined) return undefined;

	return {
		usedPercent: Math.round((used / limit) * 1000) / 10,
		resetAtSeconds: detail?.resetTime,
	};
}

const auth_schema = v.object({
	[KIMI_PROVIDER]: v.fallback(
		v.optional(v.object({ key: text_schema, access: text_schema })),
		undefined,
	),
});

export function parse_kimi_usage_response(
	payload: JsonValue,
): KimiUsageSnapshot | null {
	const root = v.parse(usage_payload_schema, payload);
	const weekly = parse_window(root.usage);

	if (!weekly) return null;

	const windows: { window: KimiUsageWindow; seconds?: number }[] = [];

	for (const entry of root.limits) {
		const window = parse_window(entry.detail);

		if (!window) continue;
		windows.push({ window, seconds: window_seconds(entry.window) });
	}

	windows.sort(
		(a, b) => (a.seconds ?? Infinity) - (b.seconds ?? Infinity),
	);

	const level = root.user?.membership?.level;

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
		const auth = v.safeParse(
			auth_schema,
			JSON.parse(await readFile(authPath, 'utf8')),
		);

		const entry = auth.success
			? auth.output[KIMI_PROVIDER]
			: undefined;

		// OAuth login: { type: "oauth", access, refresh, expires }
		// API key login: { type: "api_key", key }
		const key = entry?.key ?? entry?.access;

		if (key) return key;
	} catch {
		// Fall through to the environment variable.
	}

	return v.parse(text_schema, env.KIMI_API_KEY) ?? null;
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
