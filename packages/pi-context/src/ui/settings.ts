import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import {
	show_picker_modal,
	show_text_modal,
} from '@spences10/pi-tui-modal';
import {
	CONTEXT_SETTINGS_PRESETS,
	context_settings_from_preset,
	get_context_capture_limits,
	is_context_settings_preset,
	load_context_settings_config,
	save_context_settings_config,
	type ContextSettingsConfig,
	type ContextSettingsPreset,
} from '../config.js';
import {
	format_context_settings_status,
	format_days,
	format_max_mb,
	format_output_limit,
	format_stats,
} from '../context-format.js';
import { scope_from_context } from '../context-scope.js';
import { get_context_store } from '../store.js';

function parse_optional_setting_number(value: string): number | null {
	const normalized = value.trim().toLowerCase();
	if (
		['0', 'off', 'false', 'none', 'disabled'].includes(normalized)
	) {
		return null;
	}
	const parsed = Number(normalized);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error('Expected a positive number or off.');
	}
	return parsed;
}

function parse_optional_setting_boolean(
	value: string | undefined,
	fallback = false,
): boolean {
	if (!value) return fallback;
	const normalized = value.trim().toLowerCase();
	if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
	if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
	throw new Error('Expected purge-on-shutdown to be true or false.');
}

function parse_positive_setting_number(value: string): number {
	const parsed = Number(value.trim());
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error('Expected a positive number.');
	}
	return parsed;
}

type ContextSettingsPatch = Partial<
	Omit<ContextSettingsConfig, 'version' | 'preset'>
>;

const RETENTION_SETTING_OPTIONS = [
	{
		value: '1',
		label: '1 day',
		description: 'Minimal local cache',
		days: 1,
	},
	{
		value: '7',
		label: '7 days',
		description: 'Default retention',
		days: 7,
	},
	{
		value: '30',
		label: '30 days',
		description: 'Research window',
		days: 30,
	},
	{
		value: '90',
		label: '90 days',
		description: 'Long-lived local archive',
		days: 90,
	},
	{
		value: 'off',
		label: 'Off',
		description: 'Disable age cleanup',
		days: null,
	},
] as const;

const STORAGE_CAP_SETTING_OPTIONS = [
	{
		value: '50',
		label: '50 MiB',
		description: 'Small local cache',
		max_mb: 50,
	},
	{
		value: '250',
		label: '250 MiB',
		description: 'Balanced cap',
		max_mb: 250,
	},
	{
		value: '1024',
		label: '1 GiB',
		description: 'Research cap',
		max_mb: 1024,
	},
	{
		value: '5120',
		label: '5 GiB',
		description: 'Archive cap',
		max_mb: 5120,
	},
	{
		value: 'off',
		label: 'No cap',
		description: 'Only retention controls cleanup',
		max_mb: null,
	},
] as const;

const CAPTURE_SIZE_SETTING_OPTIONS = [
	{
		value: 'small',
		label: 'Small',
		description: 'Capture after 16 KiB / 200 lines',
		capture_max_bytes: 16 * 1024,
		capture_max_lines: 200,
	},
	{
		value: 'default',
		label: 'Default',
		description: 'Capture after 24 KiB / 300 lines',
		capture_max_bytes: 24 * 1024,
		capture_max_lines: 300,
	},
	{
		value: 'large',
		label: 'Large',
		description: 'Capture after 48 KiB / 600 lines',
		capture_max_bytes: 48 * 1024,
		capture_max_lines: 600,
	},
	{
		value: 'huge',
		label: 'Huge',
		description: 'Capture after 64 KiB / 1,000 lines',
		capture_max_bytes: 64 * 1024,
		capture_max_lines: 1_000,
	},
] as const;

export async function show_context_text_modal(
	ctx: ExtensionCommandContext,
	title: string,
	text: string,
): Promise<void> {
	await show_text_modal(ctx, {
		title,
		text,
		max_visible_lines: 18,
		overlay_options: { width: '80%', minWidth: 64 },
	});
}

export async function show_context_stats(
	ctx: ExtensionCommandContext,
): Promise<void> {
	const scope = scope_from_context(ctx);
	const text = format_stats(
		get_context_store(scope).stats({ global: true }),
		{
			audience: 'tui',
			title: false,
		},
	);
	if (ctx.hasUI) {
		await show_context_text_modal(
			ctx,
			'Context sidecar stats',
			`\n${text}`,
		);
	} else {
		ctx.ui.notify(text, 'info');
	}
}

function save_context_settings(
	ctx: ExtensionCommandContext,
	config: ContextSettingsConfig,
): void {
	save_context_settings_config(config);
	const scope = scope_from_context(ctx);
	const cleanup = get_context_store(scope).cleanup();
	ctx.ui.notify(
		`Context settings saved: ${config.preset} (${format_days(config.retention_days)}, ${format_max_mb(config.max_mb)} cap, capture ${format_output_limit(config.capture_max_bytes, config.capture_max_lines)}). Cleanup deleted ${cleanup.deleted} source(s).`,
		'info',
	);
}

function save_context_settings_patch(
	ctx: ExtensionCommandContext,
	patch: ContextSettingsPatch,
): void {
	const base =
		load_context_settings_config() ??
		context_settings_from_preset('default');
	save_context_settings(ctx, {
		...base,
		...patch,
		version: 1,
		preset: 'custom',
	});
}

async function show_context_preset_settings(
	ctx: ExtensionCommandContext,
): Promise<void> {
	const saved = load_context_settings_config();
	const selected = await show_picker_modal(ctx, {
		title: 'Context preset',
		subtitle:
			'Apply retention, storage, and capture thresholds together',
		items: Object.entries(CONTEXT_SETTINGS_PRESETS).map(
			([key, preset]) => ({
				value: key,
				label: `${preset.label}${saved?.preset === key ? ' ✓' : ''}`,
				description: preset.description,
			}),
		),
		footer: 'enter applies preset • esc back',
	});
	if (!selected) return;
	save_context_settings(
		ctx,
		context_settings_from_preset(selected as ContextSettingsPreset),
	);
}

async function show_context_retention_settings(
	ctx: ExtensionCommandContext,
): Promise<void> {
	const current = load_context_settings_config();
	const selected = await show_picker_modal(ctx, {
		title: 'Context retention days',
		subtitle: `Current: ${format_days(current?.retention_days ?? 7)}`,
		items: RETENTION_SETTING_OPTIONS.map((option) => ({
			value: option.value,
			label: `${option.label}${current?.retention_days === option.days ? ' ✓' : ''}`,
			description: option.description,
		})),
		footer: 'enter saves • esc back',
	});
	const option = RETENTION_SETTING_OPTIONS.find(
		(item) => item.value === selected,
	);
	if (!option) return;
	save_context_settings_patch(ctx, { retention_days: option.days });
}

async function show_context_storage_cap_settings(
	ctx: ExtensionCommandContext,
): Promise<void> {
	const current = load_context_settings_config();
	const selected = await show_picker_modal(ctx, {
		title: 'Context storage cap',
		subtitle: `Current: ${format_max_mb(current?.max_mb ?? null)}`,
		items: STORAGE_CAP_SETTING_OPTIONS.map((option) => ({
			value: option.value,
			label: `${option.label}${current?.max_mb === option.max_mb ? ' ✓' : ''}`,
			description: option.description,
		})),
		footer: 'enter saves • esc back',
	});
	const option = STORAGE_CAP_SETTING_OPTIONS.find(
		(item) => item.value === selected,
	);
	if (!option) return;
	save_context_settings_patch(ctx, { max_mb: option.max_mb });
}

async function show_context_capture_size_settings(
	ctx: ExtensionCommandContext,
): Promise<void> {
	const current = load_context_settings_config();
	const capture_limits = get_context_capture_limits();
	const selected = await show_picker_modal(ctx, {
		title: 'Context capture size',
		subtitle: `Current: ${format_output_limit(capture_limits.max_bytes, capture_limits.max_lines)}`,
		items: CAPTURE_SIZE_SETTING_OPTIONS.map((option) => ({
			value: option.value,
			label: `${option.label}${current?.capture_max_bytes === option.capture_max_bytes && current?.capture_max_lines === option.capture_max_lines ? ' ✓' : ''}`,
			description: option.description,
		})),
		footer: 'enter saves • esc back',
	});
	const option = CAPTURE_SIZE_SETTING_OPTIONS.find(
		(item) => item.value === selected,
	);
	if (!option) return;
	save_context_settings_patch(ctx, {
		capture_max_bytes: option.capture_max_bytes,
		capture_max_lines: option.capture_max_lines,
	});
}

export async function show_context_settings(
	ctx: ExtensionCommandContext,
	options: { nested?: boolean } = {},
): Promise<void> {
	if (!ctx.hasUI) {
		const scope = scope_from_context(ctx);
		ctx.ui.notify(
			format_context_settings_status(
				get_context_store(scope).stats(scope),
			),
			'info',
		);
		return;
	}

	while (true) {
		const scope = scope_from_context(ctx);
		const stats = get_context_store(scope).stats(scope);
		const capture_limits = get_context_capture_limits();
		const selected = await show_picker_modal(ctx, {
			title: 'Context sidecar settings',
			subtitle: `Current: ${format_days(stats.retention_days)}, ${format_max_mb(stats.max_mb)} cap, capture ${format_output_limit(capture_limits.max_bytes, capture_limits.max_lines)}`,
			items: [
				{
					value: 'capture-size',
					label: 'Capture size',
					description: 'Choose when output is moved into sidecar',
				},
				{
					value: 'retention-days',
					label: 'Retention days',
					description: 'Choose how long indexed output is kept',
				},
				{
					value: 'storage-cap',
					label: 'Storage cap',
					description: 'Choose max raw bytes stored locally',
				},
				{
					value: 'presets',
					label: 'Presets',
					description: 'Apply bundled settings all at once',
				},
				{
					value: 'show',
					label: 'Show current settings',
					description: 'Inspect effective saved/env-backed policy',
				},
			],
			footer: `enter opens • esc ${options.nested ? 'back' : 'close'}`,
		});

		if (!selected) return;
		if (selected === 'capture-size') {
			await show_context_capture_size_settings(ctx);
		} else if (selected === 'retention-days') {
			await show_context_retention_settings(ctx);
		} else if (selected === 'storage-cap') {
			await show_context_storage_cap_settings(ctx);
		} else if (selected === 'presets') {
			await show_context_preset_settings(ctx);
		} else if (selected === 'show') {
			await show_context_text_modal(
				ctx,
				'Context sidecar settings',
				format_context_settings_status(stats, {
					audience: 'tui',
					title: false,
				}),
			);
		}
	}
}

export async function handle_context_settings(
	ctx: ExtensionCommandContext,
	args: string[],
): Promise<void> {
	const [
		kind,
		days_text,
		max_mb_text,
		capture_kb_text,
		capture_lines_text,
		purge_text,
	] = args;
	if (!kind) {
		await show_context_settings(ctx);
		return;
	}
	if (kind === 'show' || kind === 'current') {
		const scope = scope_from_context(ctx);
		const stats = get_context_store(scope).stats(scope);
		const text = format_context_settings_status(
			stats,
			ctx.hasUI
				? { audience: 'tui', title: false }
				: { audience: 'tool' },
		);
		if (ctx.hasUI) {
			await show_context_text_modal(
				ctx,
				'Context sidecar settings',
				text,
			);
		} else {
			ctx.ui.notify(text, 'info');
		}
		return;
	}
	if (is_context_settings_preset(kind)) {
		save_context_settings(ctx, context_settings_from_preset(kind));
		return;
	}
	if (kind === 'custom') {
		if (!days_text || !max_mb_text) {
			ctx.ui.notify(
				'Usage: /context settings custom <days|off> <max-mb|off> [capture-kb] [capture-lines] [purge-on-shutdown]',
				'warning',
			);
			return;
		}
		try {
			const base =
				load_context_settings_config() ??
				context_settings_from_preset('default');
			save_context_settings(ctx, {
				version: 1,
				preset: 'custom',
				retention_days: parse_optional_setting_number(days_text),
				max_mb: parse_optional_setting_number(max_mb_text),
				capture_max_bytes: capture_kb_text
					? parse_positive_setting_number(capture_kb_text) * 1024
					: base.capture_max_bytes,
				capture_max_lines: capture_lines_text
					? parse_positive_setting_number(capture_lines_text)
					: base.capture_max_lines,
				purge_on_shutdown: parse_optional_setting_boolean(
					purge_text,
					base.purge_on_shutdown,
				),
			});
		} catch (error) {
			ctx.ui.notify(
				error instanceof Error ? error.message : String(error),
				'warning',
			);
		}
		return;
	}

	ctx.ui.notify(
		`Unknown context settings preset: ${kind}. Use ${Object.keys(CONTEXT_SETTINGS_PRESETS).join(', ')}, show, or custom.`,
		'warning',
	);
}
