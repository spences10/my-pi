import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

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

function read_number(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value)
		? value
		: undefined;
}

function read_record(
	value: unknown,
): Record<string, unknown> | undefined {
	return value && typeof value === 'object'
		? (value as Record<string, unknown>)
		: undefined;
}

export function parse_codex_usage_response(
	payload: unknown,
): CodexUsageSnapshot | null {
	const root = read_record(payload);
	const rate_limit = read_record(root?.rate_limit);
	const primary = read_record(rate_limit?.primary_window);
	if (!primary) return null;

	const primary_used = read_number(primary.used_percent);
	if (primary_used === undefined) return null;

	const secondary = read_record(rate_limit?.secondary_window);
	const reset_credits = read_record(root?.rate_limit_reset_credits);

	return {
		planType:
			typeof root?.plan_type === 'string'
				? root.plan_type
				: undefined,
		primaryUsedPercent: primary_used,
		primaryResetAtSeconds: read_number(primary.reset_at),
		secondaryUsedPercent: read_number(secondary?.used_percent),
		secondaryResetAtSeconds: read_number(secondary?.reset_at),
		resetCredits: read_number(reset_credits?.available_count),
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
		const auth = JSON.parse(
			await readFile(authPath, 'utf8'),
		) as unknown;
		const root = read_record(auth);
		const codex = read_record(root?.[CODEX_PROVIDER]);
		const access = codex?.access;
		return typeof access === 'string' && access.trim()
			? access
			: null;
	} catch {
		return null;
	}
}

function active_provider(ctx: ExtensionContext): string | undefined {
	return (ctx as ExtensionContext & { model?: { provider?: string } })
		.model?.provider;
}

function themed(
	ctx: ExtensionContext,
	tone: CodexUsageTone,
	text: string,
): string {
	const theme = (
		ctx.ui as {
			theme?: { fg?: (tone: string, text: string) => string };
		}
	).theme;
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
		if ((event as { status?: number }).status === 429)
			await publish(ctx);
	});

	pi.on('session_shutdown', async (_event, ctx) => {
		stop_interval();
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}
