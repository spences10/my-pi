import { readFileSync } from 'node:fs';

import * as v from 'valibot';

export type PreviewConfig = {
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
};

const default_config_path = new URL(
	'../../assets/pi-package-preview.config.json',
	import.meta.url,
);

export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue | undefined };

function object_schema<
	const Entries extends Record<string, v.GenericSchema>,
>(path: string, entries: Entries) {
	const message = `${path} must be an object.`;
	const keys = Object.keys(entries);

	return v.pipe(
		v.custom((input) => !Array.isArray(input), message),
		v.looseObject(entries, message),
		v.rawCheck(({ dataset, addIssue }) => {
			if (!dataset.typed) return;

			for (const key of Object.keys(dataset.value)) {
				if (!keys.includes(key)) {
					addIssue({
						message: `Unknown property in ${path}: ${key}.`,
					});

					return;
				}
			}
		}),
	);
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

function text_schema(path: string) {
	const message = `${path} must be a single-line string of at most 240 characters.`;

	return v.pipe(
		v.string(message),
		v.maxLength(240, message),
		v.check(single_line, message),
	);
}

function color_schema(path: string) {
	return v.pipe(
		v.string(`${path} must be a #RGB or #RRGGBB colour.`),
		v.regex(
			/^#(?:[\da-f]{3}|[\da-f]{6})$/i,
			`${path} must be a #RGB or #RRGGBB colour.`,
		),
	);
}

function boolean_schema(path: string) {
	return v.boolean(`${path} must be a boolean.`);
}

function number_schema(path: string, min: number, max: number) {
	const message = `${path} must be a number between ${min} and ${max}.`;

	return v.pipe(
		v.number(message),
		v.finite(message),
		v.minValue(min, message),
		v.maxValue(max, message),
	);
}

const gradient_schema = v.nullable(
	v.pipe(
		v.array(
			v.unknown(),
			'border.gradient must be null or an array of 2–8 colours.',
		),
		v.minLength(
			2,
			'border.gradient must be null or an array of 2–8 colours.',
		),
		v.maxLength(
			8,
			'border.gradient must be null or an array of 2–8 colours.',
		),
		v.rawTransform(({ dataset, addIssue, NEVER }) => {
			const colours: string[] = [];

			for (const [index, stop] of dataset.value.entries()) {
				const result = v.safeParse(
					color_schema(`border.gradient[${index}]`),
					stop,
				);

				if (!result.success) {
					addIssue({ message: result.issues[0].message });

					return NEVER;
				}

				colours.push(result.output);
			}

			return colours;
		}),
	),
);

const rows_schema = v.pipe(
	v.array(
		v.unknown(),
		'footer.rows must be an array of at most 6 rows.',
	),
	v.maxLength(6, 'footer.rows must be an array of at most 6 rows.'),
	v.rawTransform(({ dataset, addIssue, NEVER }) => {
		const rows: { left: string; right: string }[] = [];
		const optional = v.optional(v.unknown());

		for (const [index, row] of dataset.value.entries()) {
			const path = `footer.rows[${index}]`;

			const parsed = v.safeParse(
				object_schema(path, { left: optional, right: optional }),
				row,
			);

			if (!parsed.success) {
				addIssue({ message: parsed.issues[0].message });

				return NEVER;
			}

			const left = v.safeParse(
				text_schema(`${path}.left`),
				fallback(parsed.output.left, ''),
			);

			if (!left.success) {
				addIssue({ message: left.issues[0].message });

				return NEVER;
			}

			const right = v.safeParse(
				text_schema(`${path}.right`),
				fallback(parsed.output.right, ''),
			);

			if (!right.success) {
				addIssue({ message: right.issues[0].message });

				return NEVER;
			}

			rows.push({ left: left.output, right: right.output });
		}

		return rows;
	}),
);

function fallback<T, U>(value: T | undefined, base: U): T | U {
	return value === undefined ? base : value;
}

export function parse_preview_config(
	value: JsonValue,
	base?: PreviewConfig,
): PreviewConfig {
	const optional = v.optional(v.unknown());

	const root = v.parse(
		object_schema('config', {
			model: optional,
			project: optional,
			border: optional,
			footer: optional,
		}),
		value,
	);

	const border = v.parse(
		object_schema('border', {
			enabled: optional,
			color: optional,
			width: optional,
			radius: optional,
			gradient: optional,
		}),
		fallback(root.border, {}),
	);

	const footer = v.parse(
		object_schema('footer', {
			enabled: optional,
			separator: optional,
			editor: optional,
			color: optional,
			rows: optional,
		}),
		fallback(root.footer, {}),
	);

	return {
		model: v.parse(
			text_schema('model'),
			fallback(root.model, base?.model),
		),
		project: v.parse(
			text_schema('project'),
			fallback(root.project, base?.project),
		),
		border: {
			enabled: v.parse(
				boolean_schema('border.enabled'),
				fallback(border.enabled, base?.border.enabled),
			),
			color: v.parse(
				color_schema('border.color'),
				fallback(border.color, base?.border.color),
			),
			gradient: v.parse(
				gradient_schema,
				fallback(
					border.gradient,
					border.color === undefined
						? (base?.border.gradient ?? null)
						: null,
				),
			),
			width: v.parse(
				number_schema('border.width', 0.5, 8),
				fallback(border.width, base?.border.width),
			),
			radius: v.parse(
				number_schema('border.radius', 0, 32),
				fallback(border.radius, base?.border.radius),
			),
		},
		footer: {
			enabled: v.parse(
				boolean_schema('footer.enabled'),
				fallback(footer.enabled, base?.footer.enabled),
			),
			editor: v.parse(
				boolean_schema('footer.editor'),
				fallback(footer.editor, base?.footer.editor ?? false),
			),
			separator: v.parse(
				boolean_schema('footer.separator'),
				fallback(footer.separator, base?.footer.separator),
			),
			color: v.parse(
				color_schema('footer.color'),
				fallback(footer.color, base?.footer.color),
			),
			rows: v.parse(
				rows_schema,
				fallback(footer.rows, base?.footer.rows),
			),
		},
	};
}

function read_config(
	path: string | URL,
	base?: PreviewConfig,
): PreviewConfig {
	let content: string;

	try {
		content = readFileSync(path, 'utf8');
	} catch {
		throw new Error(`Cannot read preview config: ${path.toString()}`);
	}

	let parsed: JsonValue;

	try {
		parsed = JSON.parse(content);
	} catch {
		throw new Error(
			`Preview config must contain valid JSON: ${path.toString()}`,
		);
	}

	return parse_preview_config(parsed, base);
}

export function load_preview_config(path?: string): PreviewConfig {
	const defaults = read_config(default_config_path);

	return path === undefined ? defaults : read_config(path, defaults);
}
