import {
	getAgentDir,
	type ExtensionAPI,
	type ToolCallEvent,
	type ToolCallEventResult,
} from '@earendil-works/pi-coding-agent';
import {
	extract_input_strings,
	read_settings_section,
} from '@spences10/pi-settings';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type PreferenceRuleConfig = {
	name: string;
	toolNames?: string[];
	pattern: string;
	target?: 'command' | 'path' | 'input';
	reason: string;
};

export type CodingPreferencesConfig = {
	rules: PreferenceRuleConfig[];
};

export const default_config: CodingPreferencesConfig = {
	rules: [
		{
			name: 'no-secret-file-reads',
			toolNames: ['read', 'bash'],
			target: 'input',
			pattern: String.raw`(^|/)\.env(?:\.[^/\s"']*)?$|\.tfvars(?:\.json)?$`,
			reason:
				'Blocked by coding preferences: do not read secret files into model context. Use nopeek to list or load only the required key names without exposing secret values.',
		},
		{
			name: 'prefer-read-tool',
			toolNames: ['bash'],
			target: 'command',
			pattern: String.raw`^\s*(?:cat|sed\s+(?:-n\s+)?["']?\d+(?:,\d+)?p["']?)\s+[^|;&>]+$`,
			reason:
				'Blocked by coding preferences: use the read tool for file inspection instead of cat or sed. Do not investigate this guardrail; retry with read.',
		},
		{
			name: 'prefer-rg',
			toolNames: ['bash'],
			target: 'command',
			pattern: '^\\s*grep\\b',
			reason:
				'Blocked by coding preferences: use rg for code/text search instead of grep. Do not investigate this guardrail; retry with rg.',
		},
		{
			name: 'no-ad-hoc-todos',
			toolNames: ['write', 'edit', 'bash'],
			target: 'input',
			pattern: '(^|/)(?:TODO|TODOS|todo|todos|tasks|TASKS)\\.md$',
			reason:
				"Blocked by coding preferences: do not create ad-hoc TODO markdown files. Use Pi team/tasks or the project's existing issue tracker instead.",
		},
	],
};

function input_record(event: ToolCallEvent): Record<string, unknown> {
	return event.input as Record<string, unknown>;
}

function path_from(event: ToolCallEvent): string | undefined {
	const input = input_record(event);
	for (const key of ['path', 'file_path', 'filePath']) {
		const value = input[key];
		if (typeof value === 'string') return value;
	}
	return undefined;
}

function command_from(event: ToolCallEvent): string | undefined {
	const command = input_record(event).command;
	return typeof command === 'string' ? command : undefined;
}

function target_values(
	event: ToolCallEvent,
	target: PreferenceRuleConfig['target'] = 'input',
): string[] {
	if (target === 'command')
		return command_from(event) ? [command_from(event)!] : [];
	if (target === 'path')
		return path_from(event) ? [path_from(event)!] : [];
	return extract_input_strings(event.input);
}

export function get_global_config_path(): string {
	return join(getAgentDir(), 'coding-preferences.json');
}

export function get_project_config_path(cwd = process.cwd()): string {
	return join(resolve(cwd), '.pi', 'coding-preferences.json');
}

function read_config_file(
	path: string,
): CodingPreferencesConfig | undefined {
	let parsed: Partial<CodingPreferencesConfig> | undefined;
	if (path === get_global_config_path()) {
		parsed = read_settings_section<
			Partial<CodingPreferencesConfig> | undefined
		>('codingPreferences', undefined);
	} else {
		if (!existsSync(path)) return undefined;
		parsed = JSON.parse(
			readFileSync(path, 'utf8'),
		) as Partial<CodingPreferencesConfig>;
	}
	if (!parsed) return undefined;
	return { rules: parsed.rules ?? [] };
}

export function load_config(
	cwd = process.cwd(),
): CodingPreferencesConfig {
	const global_config = read_config_file(get_global_config_path());
	const project_config = read_config_file(
		get_project_config_path(cwd),
	);
	if (!global_config && !project_config) return default_config;
	return {
		rules: [
			...(global_config?.rules ?? []),
			...(project_config?.rules ?? []),
		],
	};
}

export function should_block_coding_preference(
	event: ToolCallEvent,
	config: CodingPreferencesConfig = load_config(),
): string | undefined {
	for (const rule of config.rules) {
		if (rule.toolNames && !rule.toolNames.includes(event.toolName))
			continue;
		const pattern = new RegExp(rule.pattern);
		if (
			target_values(event, rule.target).some((value) =>
				pattern.test(value),
			)
		)
			return rule.reason;
	}
	return undefined;
}

export default function coding_preferences(pi: ExtensionAPI) {
	const config = load_config();
	pi.on(
		'tool_call',
		async (event): Promise<ToolCallEventResult | undefined> => {
			const reason = should_block_coding_preference(event, config);
			if (!reason) return undefined;
			return { block: true, reason };
		},
	);
}
