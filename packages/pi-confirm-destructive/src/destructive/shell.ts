import type { ToolResultEvent } from '@earendil-works/pi-coding-agent';
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { is_temp_path } from './paths.js';

interface ShellToken {
	kind: 'word' | 'operator';
	value: string;
}

export interface ShellInvocation {
	command: string;
	args: string[];
}

const CONTROL_OPERATORS = new Set([
	';',
	'\n',
	'&',
	'&&',
	'|',
	'||',
	'(',
	')',
	'{',
	'}',
]);
const REDIRECT_OPERATORS = new Set(['>', '>|', '1>', '2>', '&>']);
const LEADING_SHELL_KEYWORDS = new Set([
	'!',
	'do',
	'done',
	'elif',
	'else',
	'if',
	'then',
	'until',
	'while',
]);
const SIMPLE_WRAPPERS = new Set(['command', 'exec', 'nohup']);
const SHELL_COMMANDS = new Set(['bash', 'dash', 'ksh', 'sh', 'zsh']);
const RUNNERS = new Set(['bunx', 'npx', 'pnpx']);

interface HeredocDelimiter {
	value: string;
	strip_tabs: boolean;
}

function heredoc_delimiters(line: string): HeredocDelimiter[] {
	const delimiters: HeredocDelimiter[] = [];
	let single_quoted = false;
	let double_quoted = false;

	for (let index = 0; index < line.length; index += 1) {
		const character = line[index];
		if (character === '\\') {
			index += 1;
			continue;
		}
		if (character === "'" && !double_quoted) {
			single_quoted = !single_quoted;
			continue;
		}
		if (character === '"' && !single_quoted) {
			double_quoted = !double_quoted;
			continue;
		}
		if (single_quoted || double_quoted) continue;
		if (
			character === '#' &&
			(index === 0 || /\s/.test(line[index - 1]))
		)
			break;
		if (
			character !== '<' ||
			line[index + 1] !== '<' ||
			line[index + 2] === '<'
		) {
			continue;
		}

		index += 2;
		const strip_tabs = line[index] === '-';
		if (strip_tabs) index += 1;
		while (/\s/.test(line[index] ?? '')) index += 1;

		let value = '';
		let quoted: "'" | '"' | undefined;
		for (; index < line.length; index += 1) {
			const delimiter_character = line[index];
			if (quoted) {
				if (delimiter_character === quoted) {
					quoted = undefined;
				} else if (delimiter_character === '\\' && quoted === '"') {
					if (index + 1 < line.length) value += line[++index];
				} else {
					value += delimiter_character;
				}
				continue;
			}
			if (
				delimiter_character === "'" ||
				delimiter_character === '"'
			) {
				quoted = delimiter_character;
				continue;
			}
			if (delimiter_character === '\\') {
				if (index + 1 < line.length) value += line[++index];
				continue;
			}
			if (
				/\s/.test(delimiter_character) ||
				';&|()<>'.includes(delimiter_character)
			)
				break;
			value += delimiter_character;
		}
		if (value) delimiters.push({ value, strip_tabs });
	}

	return delimiters;
}

function strip_heredoc_bodies(command: string): string {
	const pending: HeredocDelimiter[] = [];
	return command
		.split(/\r?\n/)
		.map((line) => {
			const active = pending[0];
			if (active) {
				const candidate = active.strip_tabs
					? line.replace(/^\t+/, '')
					: line;
				if (candidate === active.value) pending.shift();
				return '';
			}
			pending.push(...heredoc_delimiters(line));
			return line;
		})
		.join('\n');
}

function tokenize_shell(command: string): ShellToken[] {
	const tokens: ShellToken[] = [];
	let word = '';

	const flush_word = () => {
		if (!word) return;
		tokens.push({ kind: 'word', value: word });
		word = '';
	};

	for (let index = 0; index < command.length; index += 1) {
		const character = command[index];

		if (character === "'" || character === '"') {
			const quote = character;
			for (index += 1; index < command.length; index += 1) {
				const quoted = command[index];
				if (quoted === quote) break;
				if (
					quote === '"' &&
					quoted === '\\' &&
					index + 1 < command.length
				) {
					word += command[index + 1];
					index += 1;
					continue;
				}
				word += quoted;
			}
			continue;
		}

		if (character === '\\' && index + 1 < command.length) {
			word += command[index + 1];
			index += 1;
			continue;
		}

		if (character === '\n' || character === '\r') {
			flush_word();
			if (tokens.at(-1)?.value !== '\n') {
				tokens.push({ kind: 'operator', value: '\n' });
			}
			if (character === '\r' && command[index + 1] === '\n')
				index += 1;
			continue;
		}

		if (/\s/.test(character)) {
			flush_word();
			continue;
		}

		if (';&|(){}<>'.includes(character)) {
			flush_word();
			let operator = character;
			const next = command[index + 1];
			if (
				(character === '&' && (next === '&' || next === '>')) ||
				(character === '|' && (next === '|' || next === '>')) ||
				(character === '>' && (next === '>' || next === '|')) ||
				(character === '<' && next === '<')
			) {
				operator += next;
				index += 1;
			}
			const previous = tokens.at(-1);
			if (
				operator === '>' &&
				previous?.kind === 'word' &&
				/^[012]$/.test(previous.value)
			) {
				operator = `${previous.value}>`;
				tokens.pop();
			}
			tokens.push({ kind: 'operator', value: operator });
			continue;
		}

		word += character;
	}

	flush_word();
	return tokens;
}

function command_name(value: string): string {
	return basename(value).toLowerCase();
}

function is_assignment(word: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);
}

function skip_options(
	words: string[],
	start: number,
	options_with_values: ReadonlySet<string> = new Set(),
): number {
	let index = start;
	while (index < words.length) {
		const word = words[index];
		if (word === '--') return index + 1;
		if (!word.startsWith('-') || word === '-') return index;
		if (options_with_values.has(word)) index += 1;
		index += 1;
	}
	return index;
}

function unwrap_command(
	words: string[],
): ShellInvocation | undefined {
	let index = 0;
	while (
		index < words.length &&
		(LEADING_SHELL_KEYWORDS.has(words[index].toLowerCase()) ||
			is_assignment(words[index]))
	) {
		index += 1;
	}

	for (;;) {
		while (index < words.length && is_assignment(words[index]))
			index += 1;
		const current = command_name(words[index] ?? '');
		if (!current) return undefined;

		if (current === 'sudo') {
			index = skip_options(
				words,
				index + 1,
				new Set([
					'-C',
					'-D',
					'-g',
					'-h',
					'-p',
					'-R',
					'-r',
					'-T',
					'-t',
					'-u',
					'--chdir',
					'--group',
					'--host',
					'--prompt',
					'--role',
					'--type',
					'--user',
				]),
			);
			continue;
		}
		if (current === 'env') {
			index = skip_options(
				words,
				index + 1,
				new Set([
					'-C',
					'-S',
					'-u',
					'--chdir',
					'--split-string',
					'--unset',
				]),
			);
			while (index < words.length && is_assignment(words[index]))
				index += 1;
			continue;
		}
		if (SIMPLE_WRAPPERS.has(current)) {
			index = skip_options(words, index + 1);
			continue;
		}
		if (current === 'time') {
			index = skip_options(words, index + 1, new Set(['-f', '-o']));
			continue;
		}
		if (RUNNERS.has(current)) {
			index = skip_options(words, index + 1);
			continue;
		}
		if (current === 'nice') {
			index = skip_options(
				words,
				index + 1,
				new Set(['-n', '--adjustment']),
			);
			continue;
		}
		if (current === 'ionice') {
			index = skip_options(
				words,
				index + 1,
				new Set([
					'-c',
					'-n',
					'-p',
					'-P',
					'-u',
					'--class',
					'--classdata',
					'--pid',
					'--pgid',
					'--uid',
				]),
			);
			continue;
		}
		if (current === 'stdbuf') {
			index = skip_options(
				words,
				index + 1,
				new Set(['-e', '-i', '-o', '--error', '--input', '--output']),
			);
			continue;
		}
		if (current === 'setsid' || current === 'busybox') {
			index = skip_options(words, index + 1);
			continue;
		}
		if (current === 'pnpm' && words[index + 1] === 'exec') {
			index = skip_options(words, index + 2);
			continue;
		}
		if (current === 'git') {
			const args = words.slice(index + 1);
			const command_index = skip_options(
				args,
				0,
				new Set([
					'-C',
					'-c',
					'--config-env',
					'--exec-path',
					'--git-dir',
					'--namespace',
					'--work-tree',
				]),
			);
			return { command: current, args: args.slice(command_index) };
		}

		return { command: current, args: words.slice(index + 1) };
	}
}

function xargs_command(args: string[]): ShellInvocation | undefined {
	let index = skip_options(
		args,
		0,
		new Set(['-a', '-d', '-E', '-I', '-L', '-n', '-P', '-s']),
	);
	while (index < args.length && is_assignment(args[index]))
		index += 1;
	return unwrap_command(args.slice(index));
}

function nested_find_commands(args: string[]): ShellInvocation[] {
	const nested: ShellInvocation[] = [];
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] !== '-exec' && args[index] !== '-execdir')
			continue;
		const end = args.findIndex(
			(word, candidate) =>
				candidate > index && (word === ';' || word === '+'),
		);
		const words = args.slice(index + 1, end === -1 ? undefined : end);
		const invocation = unwrap_command(words);
		if (invocation) nested.push(...expand_invocation(invocation));
		if (end !== -1) index = end;
	}
	return nested;
}

function expand_invocation(
	invocation: ShellInvocation,
): ShellInvocation[] {
	const invocations = [invocation];
	if (SHELL_COMMANDS.has(invocation.command)) {
		const command_index = invocation.args.findIndex(
			(arg) => arg === '--command' || /^-[^-]*c/.test(arg),
		);
		const payload = invocation.args[command_index + 1];
		if (command_index !== -1 && payload) {
			invocations.push(...extract_shell_invocations(payload));
		}
	}
	if (invocation.command === 'eval' && invocation.args.length > 0) {
		invocations.push(
			...extract_shell_invocations(invocation.args.join(' ')),
		);
	}
	if (invocation.command === 'xargs') {
		const nested = xargs_command(invocation.args);
		if (nested) invocations.push(...expand_invocation(nested));
	}
	if (invocation.command === 'find') {
		invocations.push(...nested_find_commands(invocation.args));
	}
	return invocations;
}

function invocations_from_segment(
	segment: ShellToken[],
): ShellInvocation[] {
	const words = segment
		.filter((token) => token.kind === 'word')
		.map((token) => token.value);
	const invocation = unwrap_command(words);
	return invocation ? expand_invocation(invocation) : [];
}

function embedded_command_texts(command: string): string[] {
	const embedded: string[] = [];
	let single_quoted = false;
	let double_quoted = false;

	for (let index = 0; index < command.length; index += 1) {
		const character = command[index];
		if (character === '\\') {
			index += 1;
			continue;
		}
		if (character === "'" && !double_quoted) {
			single_quoted = !single_quoted;
			continue;
		}
		if (character === '"' && !single_quoted) {
			double_quoted = !double_quoted;
			continue;
		}
		if (single_quoted) continue;

		if (character === '`') {
			let end = index + 1;
			while (end < command.length) {
				if (command[end] === '\\') {
					end += 2;
					continue;
				}
				if (command[end] === '`') break;
				end += 1;
			}
			if (end < command.length) {
				embedded.push(command.slice(index + 1, end));
				index = end;
			}
			continue;
		}

		if (character !== '$' || command[index + 1] !== '(') continue;
		let depth = 1;
		let end = index + 2;
		let nested_single = false;
		let nested_double = false;
		for (; end < command.length; end += 1) {
			const nested = command[end];
			if (nested === '\\') {
				end += 1;
				continue;
			}
			if (nested === "'" && !nested_double) {
				nested_single = !nested_single;
				continue;
			}
			if (nested === '"' && !nested_single) {
				nested_double = !nested_double;
				continue;
			}
			if (nested_single) continue;
			if (nested === '(') depth += 1;
			if (nested === ')') depth -= 1;
			if (depth === 0) break;
		}
		if (depth === 0) {
			embedded.push(command.slice(index + 2, end));
			index = end;
		}
	}
	return embedded;
}

export function extract_shell_invocations(
	command: string,
): ShellInvocation[] {
	const prepared_command = strip_heredoc_bodies(command);
	const tokens = tokenize_shell(prepared_command);
	const invocations: ShellInvocation[] = [];
	let segment: ShellToken[] = [];

	const flush_segment = () => {
		if (segment.length > 0) {
			invocations.push(...invocations_from_segment(segment));
			segment = [];
		}
	};

	for (const token of tokens) {
		if (
			token.kind === 'operator' &&
			CONTROL_OPERATORS.has(token.value)
		) {
			flush_segment();
			continue;
		}
		segment.push(token);
	}
	flush_segment();
	for (const embedded of embedded_command_texts(prepared_command)) {
		invocations.push(...extract_shell_invocations(embedded));
	}
	return invocations;
}

function paths_from_invocation(
	invocation: ShellInvocation,
): string[] {
	const offset =
		invocation.command === 'git' && invocation.args[0] === 'rm'
			? 1
			: 0;
	return invocation.args
		.slice(offset)
		.filter(
			(word) =>
				word !== '--' &&
				word !== ';' &&
				word !== '+' &&
				word !== '{}' &&
				!word.startsWith('-'),
		);
}

export function extract_command_paths(
	command: string,
	command_name_to_find: 'rm' | 'git-rm',
): string[] | undefined {
	const invocations = extract_shell_invocations(command).filter(
		(invocation) =>
			command_name_to_find === 'rm'
				? ['rm', 'rmdir', 'shred', 'unlink'].includes(
						invocation.command,
					)
				: invocation.command === 'git' && invocation.args[0] === 'rm',
	);
	if (invocations.length === 0) return undefined;
	return invocations.flatMap(paths_from_invocation);
}

export function extract_overwrite_paths(command: string): string[] {
	const tokens = tokenize_shell(command);
	const paths: string[] = [];
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (
			token.kind !== 'operator' ||
			!REDIRECT_OPERATORS.has(token.value)
		) {
			continue;
		}
		const target = tokens[index + 1];
		if (target?.kind === 'word') paths.push(target.value);
	}
	return paths;
}

function option_takes_value(
	command_name_to_check: string,
	option: string,
): boolean {
	const value_options: Record<string, string[]> = {
		mkdir: ['-m', '--mode', '-Z', '--context'],
		touch: ['-r', '--reference', '-d', '--date', '-t'],
	};
	return (
		value_options[command_name_to_check]?.includes(option) ?? false
	);
}

function extract_simple_create_paths(
	command: string,
	cwd: string,
): string[] {
	const invocations = extract_shell_invocations(command);
	const paths: string[] = [];
	for (const invocation of invocations) {
		if (!['mkdir', 'touch'].includes(invocation.command)) continue;
		for (let index = 0; index < invocation.args.length; index += 1) {
			const word = invocation.args[index];
			if (!word || word === '--') continue;
			if (word.startsWith('-')) {
				if (option_takes_value(invocation.command, word)) index += 1;
				continue;
			}
			const absolute = resolve(cwd, word);
			if (is_temp_path(absolute) && !existsSync(absolute))
				paths.push(absolute);
		}
	}
	return paths;
}

function extract_redirect_create_paths(
	command: string,
	cwd: string,
): string[] {
	return extract_overwrite_paths(command)
		.map((path) => resolve(cwd, path))
		.filter((path) => is_temp_path(path) && !existsSync(path));
}

export function extract_bash_create_paths(
	command: string,
	cwd: string,
): string[] {
	return [
		...extract_simple_create_paths(command, cwd),
		...extract_redirect_create_paths(command, cwd),
	];
}

export function command_may_create_temp_path(
	command: string,
): boolean {
	return extract_shell_invocations(command).some(
		(invocation) => invocation.command === 'mktemp',
	);
}

function text_content(event: ToolResultEvent): string {
	return event.content
		.map((part) => {
			if ('text' in part && typeof part.text === 'string')
				return part.text;
			return '';
		})
		.join('');
}

export function extract_created_temp_paths_from_result(
	event: ToolResultEvent,
): string[] {
	return text_content(event)
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && is_temp_path(line) && existsSync(line))
		.map((line) => resolve(line));
}
