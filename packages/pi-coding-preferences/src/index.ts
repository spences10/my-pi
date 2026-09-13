import {
	getAgentDir,
	type ExtensionAPI,
	type ToolCallEvent,
	type ToolCallEventResult,
} from '@earendil-works/pi-coding-agent';
import { read_settings_section } from '@spences10/pi-settings';
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

export type CodingPreferenceViolation = {
	field: string;
	reason: string;
	rule_name: string;
};

type TargetValue = {
	field: string;
	value: string;
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

function path_value_from(
	event: ToolCallEvent,
): TargetValue | undefined {
	const input = input_record(event);
	for (const key of ['path', 'file_path', 'filePath']) {
		const value = input[key];
		if (typeof value === 'string') {
			return { field: `input.${key}`, value };
		}
	}
	return undefined;
}

function command_value_from(
	event: ToolCallEvent,
): TargetValue | undefined {
	const command = input_record(event).command;
	return typeof command === 'string'
		? { field: 'input.command', value: command }
		: undefined;
}

function input_values(
	value: unknown,
	field = 'input',
): TargetValue[] {
	if (typeof value === 'string') return [{ field, value }];
	if (Array.isArray(value)) {
		return value.flatMap((item, index) =>
			input_values(item, `${field}[${index}]`),
		);
	}
	if (!value || typeof value !== 'object') return [];
	return Object.entries(value as Record<string, unknown>).flatMap(
		([key, item]) => input_values(item, `${field}.${key}`),
	);
}

function target_values(
	event: ToolCallEvent,
	target: PreferenceRuleConfig['target'] = 'input',
): TargetValue[] {
	if (target === 'command') {
		const command = command_value_from(event);
		return command ? [command] : [];
	}
	if (target === 'path') {
		const path = path_value_from(event);
		return path ? [path] : [];
	}
	return input_values(event.input);
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

export function find_coding_preference_violation(
	event: ToolCallEvent,
	config: CodingPreferencesConfig = load_config(),
): CodingPreferenceViolation | undefined {
	for (const rule of config.rules) {
		if (rule.toolNames && !rule.toolNames.includes(event.toolName))
			continue;
		const pattern = new RegExp(rule.pattern);
		for (const target of target_values(event, rule.target)) {
			pattern.lastIndex = 0;
			if (pattern.test(target.value)) {
				return {
					field: target.field,
					reason: rule.reason,
					rule_name: rule.name,
				};
			}
		}
	}
	return undefined;
}

export function should_block_coding_preference(
	event: ToolCallEvent,
	config: CodingPreferencesConfig = load_config(),
): string | undefined {
	return find_coding_preference_violation(event, config)?.reason;
}

export function format_coding_preference_violation(
	violation: CodingPreferenceViolation,
): string {
	return `${violation.reason} [rule: ${violation.rule_name}; field: ${violation.field}]`;
}

export default function coding_preferences(pi: ExtensionAPI) {
	const config = load_config();
	pi.on(
		'tool_call',
		async (event): Promise<ToolCallEventResult | undefined> => {
			const violation = find_coding_preference_violation(
				event,
				config,
			);
			if (!violation) return undefined;
			return {
				block: true,
				reason: format_coding_preference_violation(violation),
			};
		},
	);
}
