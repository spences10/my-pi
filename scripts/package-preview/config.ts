import { readFileSync } from 'node:fs';

export interface PreviewConfig {
	model: string;
	project: string;
	border: {
		enabled: boolean;
		color: string;
		gradient: string[] | null;
		width: number;
		radius: number;
	};
	footer: {
		enabled: boolean;
		separator: boolean;
		editor: boolean;
		color: string;
		rows: { left: string; right: string }[];
	};
}

const default_config_path = new URL(
	'../../assets/pi-package-preview.config.json',
	import.meta.url,
);

function object(
	value: unknown,
	path: string,
	keys: string[],
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${path} must be an object.`);
	}

	for (const key of Object.keys(value)) {
		if (!keys.includes(key)) {
			throw new Error(`Unknown property in ${path}: ${key}.`);
		}
	}

	return value as Record<string, unknown>;
}

function single_line(value: string): boolean {
	for (const char of value) {
		const code = char.charCodeAt(0);

		if (
			code < 0x20 ||
			(code >= 0x7f && code <= 0x9f) ||
			code === 0x2028 ||
			code === 0x2029
		)
			return false;
	}

	return true;
}

function text(value: unknown, path: string): string {
	if (
		typeof value !== 'string' ||
		value.length > 240 ||
		!single_line(value)
	) {
		throw new Error(
			`${path} must be a single-line string of at most 240 characters.`,
		);
	}

	return value;
}

function color(value: unknown, path: string): string {
	if (
		typeof value !== 'string' ||
		!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)
	) {
		throw new Error(`${path} must be a #RGB or #RRGGBB colour.`);
	}

	return value;
}

function gradient(value: unknown): string[] | null {
	if (value === null) return null;

	if (!Array.isArray(value) || value.length < 2 || value.length > 8) {
		throw new Error(
			'border.gradient must be null or an array of 2–8 colours.',
		);
	}

	return value.map((stop: unknown, index) =>
		color(stop, `border.gradient[${index}]`),
	);
}

function boolean(value: unknown, path: string): boolean {
	if (typeof value !== 'boolean')
		throw new Error(`${path} must be a boolean.`);

	return value;
}

function number(
	value: unknown,
	path: string,
	min: number,
	max: number,
): number {
	if (
		typeof value !== 'number' ||
		!Number.isFinite(value) ||
		value < min ||
		value > max
	) {
		throw new Error(
			`${path} must be a number between ${min} and ${max}.`,
		);
	}

	return value;
}

function rows(value: unknown): PreviewConfig['footer']['rows'] {
	if (!Array.isArray(value) || value.length > 6) {
		throw new Error(
			'footer.rows must be an array of at most 6 rows.',
		);
	}

	return value.map((row: unknown, index) => {
		const path = `footer.rows[${index}]`;
		const parsed = object(row, path, ['left', 'right']);

		return {
			left: text(
				parsed.left === undefined ? '' : parsed.left,
				`${path}.left`,
			),
			right: text(
				parsed.right === undefined ? '' : parsed.right,
				`${path}.right`,
			),
		};
	});
}

function fallback(value: unknown, base: unknown): unknown {
	return value === undefined ? base : value;
}

export function parse_preview_config(
	value: unknown,
	base?: PreviewConfig,
): PreviewConfig {
	const root = object(value, 'config', [
		'model',
		'project',
		'border',
		'footer',
	]);

	const border = object(fallback(root.border, {}), 'border', [
		'enabled',
		'color',
		'width',
		'radius',
		'gradient',
	]);

	const footer = object(fallback(root.footer, {}), 'footer', [
		'enabled',
		'separator',
		'editor',
		'color',
		'rows',
	]);

	return {
		model: text(fallback(root.model, base?.model), 'model'),
		project: text(fallback(root.project, base?.project), 'project'),
		border: {
			enabled: boolean(
				fallback(border.enabled, base?.border.enabled),
				'border.enabled',
			),
			color: color(
				fallback(border.color, base?.border.color),
				'border.color',
			),
			gradient: gradient(
				fallback(
					border.gradient,
					border.color === undefined
						? (base?.border.gradient ?? null)
						: null,
				),
			),
			width: number(
				fallback(border.width, base?.border.width),
				'border.width',
				0.5,
				8,
			),
			radius: number(
				fallback(border.radius, base?.border.radius),
				'border.radius',
				0,
				32,
			),
		},
		footer: {
			enabled: boolean(
				fallback(footer.enabled, base?.footer.enabled),
				'footer.enabled',
			),
			editor: boolean(
				fallback(footer.editor, base?.footer.editor ?? false),
				'footer.editor',
			),
			separator: boolean(
				fallback(footer.separator, base?.footer.separator),
				'footer.separator',
			),
			color: color(
				fallback(footer.color, base?.footer.color),
				'footer.color',
			),
			rows: rows(fallback(footer.rows, base?.footer.rows)),
		},
	};
}

function read_config(path: string | URL): unknown {
	let content: string;

	try {
		content = readFileSync(path, 'utf8');
	} catch {
		throw new Error(`Cannot read preview config: ${path.toString()}`);
	}

	try {
		return JSON.parse(content) as unknown;
	} catch {
		throw new Error(
			`Preview config must contain valid JSON: ${path.toString()}`,
		);
	}
}

export function load_preview_config(path?: string): PreviewConfig {
	const defaults = parse_preview_config(
		read_config(default_config_path),
	);

	return path === undefined
		? defaults
		: parse_preview_config(read_config(path), defaults);
}
