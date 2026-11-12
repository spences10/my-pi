import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as v from 'valibot';

const STATUS_KEY = 'codex-usage';
const CODEX_PROVIDER = 'openai-codex';
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const FETCH_INTERVAL_MS = 5 * 60 * 1000;
const TURN_REFRESH_DEBOUNCE_MS = 60 * 1000;

export interface CodexUsageSnapshot {
	planType?: string;
	primaryUsedPercent: number;
	primaryResetAtSeconds?: number;
	secondaryUsedPercent?: number;
	secondaryResetAtSeconds?: number;
	resetCredits?: number;
}

type CodexUsageTone = 'dim' | 'warning' | 'error';

export function is_codex_provider(
	provider: string | undefined,
): boolean {
	return provider === CODEX_PROVIDER;
}

type JsonValue =
	| null
	| string
	| number
	| boolean
	| JsonValue[]
	| { [key: string]: JsonValue };

const number_schema = v.fallback(
	v.optional(v.pipe(v.number(), v.finite())),
	undefined,
);

const window_schema = v.fallback(
	v.optional(
		v.object({
			used_percent: number_schema,
			reset_at: number_schema,
		}),
	),
	undefined,
);

const usage_payload_schema = v.fallback(
	v.object({
		plan_type: v.fallback(v.optional(v.string()), undefined),
		rate_limit: v.fallback(
			v.optional(
				v.object({
					primary_window: window_schema,
					secondary_window: window_schema,
				}),
			),
			undefined,
		),
		rate_limit_reset_credits: v.fallback(
			v.optional(v.object({ available_count: number_schema })),
			undefined,
		),
	}),
	{
		plan_type: undefined,
		rate_limit: undefined,
		rate_limit_reset_credits: undefined,
	},
);

const auth_schema = v.object({
	[CODEX_PROVIDER]: v.fallback(
		v.optional(
			v.object({
				access: v.fallback(
					v.optional(
						v.pipe(
							v.string(),
							v.check((text) => text.trim() !== ''),
						),
					),
					undefined,
				),
			}),
		),
		undefined,
	),
});

export function parse_codex_usage_response(
	payload: JsonValue,
): CodexUsageSnapshot | null {
	const root = v.parse(usage_payload_schema, payload);
	const primary = root.rate_limit?.primary_window;

	if (!primary) return null;

	const primary_used = primary.used_percent;

	if (primary_used === undefined) return null;

	const secondary = root.rate_limit?.secondary_window;

	return {
		planType: root.plan_type,
		primaryUsedPercent: primary_used,
		primaryResetAtSeconds: primary.reset_at,
		secondaryUsedPercent: secondary?.used_percent,
		secondaryResetAtSeconds: secondary?.reset_at,
		resetCredits: root.rate_limit_reset_credits?.available_count,
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

export function format_codex_usage_status(
	snapshot: CodexUsageSnapshot,
	nowMs = Date.now(),
): string {
	const primary_reset = compact_reset(
		snapshot.primaryResetAtSeconds,
		nowMs,
	);

	const primary = primary_reset
		? `${primary_reset} ${percent(snapshot.primaryUsedPercent)}`
		: percent(snapshot.primaryUsedPercent);

	const parts = [`cx ${primary}`];

	if (snapshot.secondaryUsedPercent !== undefined) {
		const secondary_reset = compact_reset(
			snapshot.secondaryResetAtSeconds,
			nowMs,
		);

		parts.push(
			secondary_reset
				? `${secondary_reset} ${percent(snapshot.secondaryUsedPercent)}`
				: percent(snapshot.secondaryUsedPercent),
		);
	}

	return parts.join(' · ');
}

export function get_codex_usage_tone(
	snapshot: CodexUsageSnapshot,
): CodexUsageTone {
	const max_used = Math.max(
		snapshot.primaryUsedPercent,
		snapshot.secondaryUsedPercent ?? 0,
	);

	if (max_used >= 100) return 'error';

	if (max_used >= 80) return 'warning';

	return 'dim';
}

export async function read_codex_access_token(
	authPath = join(homedir(), '.pi', 'agent', 'auth.json'),
): Promise<string | null> {
	try {
		const auth = v.safeParse(
			auth_schema,
			JSON.parse(await readFile(authPath, 'utf8')),
		);

		return (
			(auth.success
				? auth.output[CODEX_PROVIDER]?.access
				: undefined) ?? null
		);
	} catch {
		return null;
	}
}

function active_provider(ctx: ExtensionContext): string | undefined {
	return ctx.model?.provider;
}

function themed(
	ctx: ExtensionContext,
	tone: CodexUsageTone,
	text: string,
): string {
	const theme = ctx.ui.theme;

	return theme?.fg ? theme.fg(tone, text) : text;
}

async function fetch_codex_usage(): Promise<CodexUsageSnapshot | null> {
	const token = await read_codex_access_token();

	if (!token) return null;

	const response = await fetch(CODEX_USAGE_URL, {
		headers: {
			Accept: 'application/json',
			Authorization: `Bearer ${token}`,
			'OAI-Product-Sku': 'CODEX',
			originator: 'Codex Desktop',
		},
	});

	if (!response.ok)
		throw new Error(`Codex usage failed: ${response.status}`);

	return parse_codex_usage_response(await response.json());
}

export default async function codex_usage(pi: ExtensionAPI) {
	let interval: NodeJS.Timeout | undefined;
	let last_turn_refresh = 0;

	function stop_interval() {
		if (!interval) return;
		clearInterval(interval);
		interval = undefined;
	}

	async function publish(ctx: ExtensionContext) {
		if (!ctx.hasUI || !is_codex_provider(active_provider(ctx))) {
			stop_interval();
			ctx.ui.setStatus(STATUS_KEY, undefined);

			return;
		}

		try {
			const snapshot = await fetch_codex_usage();

			const text = snapshot
				? format_codex_usage_status(snapshot)
				: undefined;

			ctx.ui.setStatus(
				STATUS_KEY,
				snapshot
					? themed(ctx, get_codex_usage_tone(snapshot), text!)
					: undefined,
			);
		} catch {
			ctx.ui.setStatus(STATUS_KEY, themed(ctx, 'dim', 'cx ?'));
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
		if (event.status === 429) await publish(ctx);
	});

	pi.on('session_shutdown', async (_event, ctx) => {
		stop_interval();
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}
