import {
	getAgentDir,
	type ExtensionAPI,
	type ToolCallEvent,
	type ToolCallEventResult,
} from '@earendil-works/pi-coding-agent';
import {
	input_node_schema,
	read_settings_section,
	type InputNode,
	type JsonValue,
} from '@spences10/pi-settings';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as v from 'valibot';
import { register_guarded_tools } from './guarded-tools.js';
import {
	naming_config_schema,
	resolve_naming_config,
	type NamingConfig,
} from './naming.js';

export { assert_naming, resolve_naming_config } from './naming.js';

export type { NamingConfig, NamingStyle } from './naming.js';

export type PreferenceRuleConfig = {
	name: string;
	toolNames?: string[];
	pattern: string;
	target?: 'command' | 'path' | 'input' | 'content';
	reason: string;
};

export type CodingPreferencesConfig = {
	rules: PreferenceRuleConfig[];
	naming?: NamingConfig | false;
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

const tool_input_schema = v.looseObject({
	path: v.fallback(v.optional(v.string()), undefined),
	file_path: v.fallback(v.optional(v.string()), undefined),
	filePath: v.fallback(v.optional(v.string()), undefined),
	command: v.fallback(v.optional(v.string()), undefined),
	content: v.fallback(v.optional(v.string()), undefined),
	newText: v.fallback(v.optional(v.string()), undefined),
	edits: v.optional(v.unknown()),
});

function tool_input(
	event: ToolCallEvent,
): v.InferOutput<typeof tool_input_schema> {
	return v.parse(tool_input_schema, event.input);
}

function path_value_from(
	event: ToolCallEvent,
): TargetValue | undefined {
	const input = tool_input(event);

	const candidates: Array<[string, string | undefined]> = [
		['path', input.path],
		['file_path', input.file_path],
		['filePath', input.filePath],
	];

	for (const [key, value] of candidates) {
		if (value !== undefined) {
			return { field: `input.${key}`, value };
		}
	}

	return undefined;
}

function command_value_from(
	event: ToolCallEvent,
): TargetValue | undefined {
	const command = tool_input(event).command;

	return command !== undefined
		? { field: 'input.command', value: command }
		: undefined;
}

const edit_new_text_schema = v.fallback(
	v.object({
		newText: v.fallback(v.optional(v.string()), undefined),
	}),
	{},
);

function input_values(
	value: InputNode,
	field = 'input',
): TargetValue[] {
	if (value === null) return [];

	if (Array.isArray(value)) {
		return value.flatMap((item, index) =>
			input_values(item, `${field}[${index}]`),
		);
	}

	if (!(value instanceof Object)) return [{ field, value }];

	return Object.entries(value).flatMap(([key, item]) =>
		input_values(item, `${field}.${key}`),
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

	if (target === 'content') {
		const input = tool_input(event);

		if (event.toolName === 'write') {
			return input.content !== undefined
				? [{ field: 'input.content', value: input.content }]
				: [];
		}

		if (event.toolName !== 'edit') return [];
		const replacements: TargetValue[] = [];

		if (input.newText !== undefined) {
			replacements.push({
				field: 'input.newText',
				value: input.newText,
			});
		}

		const edits = v.safeParse(
			v.array(edit_new_text_schema),
			input.edits,
		);

		if (edits.success) {
			edits.output.forEach((edit, index) => {
				if (edit.newText === undefined) return;
				replacements.push({
					field: `input.edits[${index}].newText`,
					value: edit.newText,
				});
			});
		}

		return replacements;
	}

	return input_values(v.parse(input_node_schema, event.input));
}

export function get_global_config_path(): string {
	return join(getAgentDir(), 'coding-preferences.json');
}

export function get_project_config_path(cwd = process.cwd()): string {
	return join(resolve(cwd), '.pi', 'coding-preferences.json');
}

const preference_rule_schema: v.GenericSchema<
	unknown,
	PreferenceRuleConfig
> = v.object({
	name: v.string(),
	toolNames: v.exactOptional(v.array(v.string())),
	pattern: v.string(),
	target: v.exactOptional(
		v.picklist(['command', 'path', 'input', 'content']),
	),
	reason: v.string(),
});

const config_file_schema: v.GenericSchema<
	unknown,
	Partial<CodingPreferencesConfig> | null | undefined
> = v.nullish(
	v.object({
		rules: v.exactOptional(v.array(preference_rule_schema)),
		naming: v.exactOptional(naming_config_schema),
	}),
);

/** The most specific validation message, so a bad naming style names itself. */
function issue_message(issue: v.BaseIssue<unknown>): string {
	// Nested issue paths are relative to their parent issue.
	const deepest = (issue.issues ?? [])
		.filter((nested) => (nested.path?.length ?? 0) > 0)
		.sort((a, b) => (b.path?.length ?? 0) - (a.path?.length ?? 0))[0];

	return deepest ? issue_message(deepest) : issue.message;
}

function parse_config_file(
	raw: JsonValue | undefined,
): Partial<CodingPreferencesConfig> | undefined {
	const parsed = v.safeParse(config_file_schema, raw);

	if (!parsed.success)
		throw new Error(issue_message(parsed.issues[0]));

	return parsed.output ?? undefined;
}

function read_config_file(
	path: string,
): Partial<CodingPreferencesConfig> | undefined {
	if (path === get_global_config_path()) {
		return parse_config_file(
			read_settings_section<JsonValue | undefined>(
				'codingPreferences',
				undefined,
			),
		);
	}

	if (!existsSync(path)) return undefined;

	return parse_config_file(JSON.parse(readFileSync(path, 'utf8')));
}

export function load_config(
	cwd = process.cwd(),
): CodingPreferencesConfig {
	const global_config = read_config_file(get_global_config_path());

	const project_config = read_config_file(
		get_project_config_path(cwd),
	);

	if (!global_config && !project_config) return default_config;
	resolve_naming_config(global_config?.naming);
	resolve_naming_config(project_config?.naming);
	const project_naming = project_config?.naming;
	let naming = global_config?.naming;

	if (project_naming !== undefined) {
		naming =
			project_naming === false
				? false
				: { ...global_config?.naming, ...project_naming };
	}

	return {
		rules:
			global_config?.rules === undefined &&
			project_config?.rules === undefined
				? default_config.rules
				: [
						...(global_config?.rules ?? []),
						...(project_config?.rules ?? []),
					],
		naming,
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
	register_guarded_tools(pi, (cwd) => load_config(cwd).naming);
	pi.on(
		'tool_call',
		async (event, ctx): Promise<ToolCallEventResult | undefined> => {
			const violation = find_coding_preference_violation(
				event,
				load_config(ctx.cwd),
			);

			if (!violation) return undefined;

			return {
				block: true,
				reason: format_coding_preference_violation(violation),
			};
		},
	);
}
