import { resolve } from 'node:path';

const normalize = (value: string) => value.replaceAll('\\', '/');

export function canonical_scope(cwd: string, value: string): string {
	const root = normalize(resolve(cwd));
	const candidate = normalize(resolve(cwd, value));
	if (
		candidate !== root &&
		!candidate.startsWith(root === '/' ? '/' : `${root}/`)
	)
		throw new Error('Path scope must remain inside the workspace');
	return candidate;
}

export function scope_expression(pattern: string): RegExp {
	let expression = '^';
	for (let index = 0; index < pattern.length; index += 1) {
		const character = pattern[index]!;
		if (character === '*' && pattern[index + 1] === '*') {
			if (pattern[index + 2] === '/') {
				expression += '(?:.*/)?';
				index += 2;
			} else {
				expression += '.*';
				index += 1;
			}
		} else if (character === '*') expression += '[^/]*';
		else if (character === '?') expression += '[^/]';
		else
			expression += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
	}
	return new RegExp(`${expression}$`);
}

export function scope_matches(
	cwd: string,
	path: string,
	pattern: string,
): boolean {
	const candidate = canonical_scope(cwd, path);
	const normalized = canonical_scope(cwd, pattern);
	return /[?*]/.test(normalized)
		? scope_expression(normalized).test(candidate)
		: candidate === normalized ||
				candidate.startsWith(`${normalized}/`);
}

export function scopes_overlap(
	cwd: string,
	left: string,
	right: string,
): boolean {
	const a = canonical_scope(cwd, left);
	const b = canonical_scope(cwd, right);
	if (!/[?*]/.test(a) && !/[?*]/.test(b))
		return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
	const prefix = (value: string) =>
		value.slice(0, value.search(/[?*]/)).replace(/\/$/, '');
	if (/[?*]/.test(a) && !/[?*]/.test(b)) {
		const ap = prefix(a);
		return (
			scope_expression(a).test(b) ||
			b === ap ||
			b.startsWith(`${ap}/`) ||
			ap.startsWith(`${b}/`)
		);
	}
	if (!/[?*]/.test(a) && /[?*]/.test(b))
		return scopes_overlap(cwd, b, a);
	const ap = prefix(a);
	const bp = prefix(b);
	return (
		ap === bp || ap.startsWith(`${bp}/`) || bp.startsWith(`${ap}/`)
	);
}
