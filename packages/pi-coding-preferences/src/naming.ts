import { parse, type AST } from 'svelte/compiler';
import ts from 'typescript';
import * as v from 'valibot';

const naming_style_schema = v.picklist([
	'snake_case',
	'camelCase',
	'PascalCase',
]);

export type NamingStyle = v.InferOutput<typeof naming_style_schema>;

const NAMING_STYLE_MESSAGE =
	'Invalid codingPreferences.naming style. Use snake_case, camelCase, PascalCase, or false.';

const NAMING_OBJECT_MESSAGE =
	'codingPreferences.naming must be an object or false.';

const naming_style_setting_schema = v.union(
	[v.literal(false), naming_style_schema],
	NAMING_STYLE_MESSAGE,
);

/** The `naming` section of a coding-preferences file: a style per category, or false. */
export const naming_config_schema = v.union(
	[
		v.literal(false),
		v.pipe(
			v.object({
				variables: v.exactOptional(naming_style_setting_schema),
				functions: v.exactOptional(naming_style_setting_schema),
				types: v.exactOptional(naming_style_setting_schema),
			}),
			v.check((config) => !Array.isArray(config)),
		),
	],
	NAMING_OBJECT_MESSAGE,
);

const node_offsets_schema = v.object({
	start: v.number(),
	end: v.number(),
});

export type NamingConfig = Exclude<
	v.InferOutput<typeof naming_config_schema>,
	false
>;

type NamingCategory = keyof NamingConfig;

type NamingViolation = {
	category: NamingCategory;
	name: string;
	style: NamingStyle;
	position: number;
};

export function resolve_naming_config(
	config: NamingConfig | false | undefined,
): Required<NamingConfig> | false {
	if (config === false) return false;

	if (
		config !== undefined &&
		(!(config instanceof Object) || Array.isArray(config))
	)
		throw new Error(
			'codingPreferences.naming must be an object or false.',
		);

	const resolved: Required<NamingConfig> = {
		variables: 'snake_case',
		functions: 'snake_case',
		types: 'PascalCase',
		...config,
	};

	for (const value of Object.values(resolved)) {
		if (
			value !== false &&
			!['snake_case', 'camelCase', 'PascalCase'].includes(value)
		)
			throw new Error(
				'Invalid codingPreferences.naming style. Use snake_case, camelCase, PascalCase, or false.',
			);
	}

	return resolved;
}

export function supports_naming(path: string): boolean {
	return /\.(?:[cm]?[jt]s|[jt]sx|svelte)$/i.test(path);
}

function matches_style(name: string, style: NamingStyle): boolean {
	const identifier = name.replace(/^[_$]+|[_$]+$/g, '');

	if (!identifier) return true;

	if (style === 'snake_case')
		return /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(identifier);

	if (style === 'camelCase')
		return /^[a-z][a-zA-Z0-9]*$/.test(identifier);

	return /^[A-Z][a-zA-Z0-9]*$/.test(identifier);
}

function parse_script(path: string, content: string): ts.SourceFile {
	const options: ts.CompilerOptions = {
		allowJs: true,
		noLib: true,
		noResolve: true,
		target: ts.ScriptTarget.Latest,
		jsx: ts.JsxEmit.Preserve,
	};

	const source = ts.createSourceFile(
		path,
		content,
		ts.ScriptTarget.Latest,
		true,
	);

	const host = ts.createCompilerHost(options);
	host.getSourceFile = (name) => (name === path ? source : undefined);
	host.fileExists = (name) => name === path;
	host.readFile = (name) => (name === path ? content : undefined);
	const program = ts.createProgram([path], options, host);
	const diagnostic = program.getSyntacticDiagnostics(source)[0];

	if (diagnostic) {
		const { line, character } = source.getLineAndCharacterOfPosition(
			diagnostic.start ?? 0,
		);

		throw new Error(
			`Cannot validate naming at ${path}:${line + 1}:${character + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
		);
	}

	return source;
}

function script_violations(
	path: string,
	content: string,
	config: Required<NamingConfig>,
	offset = 0,
): NamingViolation[] {
	const source = parse_script(path, content);
	const violations: NamingViolation[] = [];

	function check(
		name: ts.Identifier | undefined,
		category: NamingCategory,
	) {
		const style = config[category];

		if (name && style && !matches_style(name.text, style))
			violations.push({
				category,
				name: name.text,
				style,
				position: offset + name.getStart(source),
			});
	}

	function binding(
		name: ts.BindingName,
		category: NamingCategory = 'variables',
	) {
		if (ts.isIdentifier(name)) {
			check(name, category);

			return;
		}

		for (const element of name.elements) {
			if (ts.isOmittedExpression(element)) continue;

			// Shorthand object bindings preserve an external property/prop name.
			if (
				ts.isObjectBindingPattern(name) &&
				!element.propertyName &&
				!element.dotDotDotToken
			)
				continue;
			binding(element.name);
		}
	}

	function visit(node: ts.Node) {
		if (ts.isVariableDeclaration(node)) {
			const initializer = node.initializer;
			let category: NamingCategory = 'variables';

			if (
				initializer &&
				(ts.isArrowFunction(initializer) ||
					ts.isFunctionExpression(initializer))
			)
				category = 'functions';
			else if (initializer && ts.isClassExpression(initializer))
				category = 'types';
			binding(node.name, category);
		} else if (
			ts.isParameter(node) &&
			!ts.isParameterPropertyDeclaration(node, node.parent)
		)
			binding(node.name);
		else if (
			ts.isFunctionDeclaration(node) ||
			ts.isFunctionExpression(node)
		)
			check(node.name, 'functions');
		else if (
			ts.isClassDeclaration(node) ||
			ts.isClassExpression(node) ||
			ts.isInterfaceDeclaration(node) ||
			ts.isTypeAliasDeclaration(node) ||
			ts.isEnumDeclaration(node)
		)
			check(node.name, 'types');
		ts.forEachChild(node, visit);
	}

	visit(source);

	return violations;
}

function violations_in(
	path: string,
	content: string,
	config: Required<NamingConfig>,
): NamingViolation[] {
	if (!path.toLowerCase().endsWith('.svelte'))
		return script_violations(path, content, config);
	let root: AST.Root;

	try {
		root = parse(content, { modern: true });
	} catch (error) {
		throw new Error(
			`Cannot validate naming at ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	return [root.module, root.instance].flatMap((script) => {
		if (!script) return [];

		// Svelte supplies offsets on its ESTree nodes, beyond the ESTree types.
		const { start, end } = v.parse(
			node_offsets_schema,
			script.content,
		);

		return script_violations(
			`${path}.ts`,
			content.slice(start, end),
			config,
			start,
		);
	});
}

export function assert_naming(
	path: string,
	content: string,
	previous: string | undefined,
	config: Required<NamingConfig>,
): void {
	if (!supports_naming(path)) return;
	let old_violations: NamingViolation[] = [];

	if (previous !== undefined) {
		try {
			old_violations = violations_in(path, previous, config);
		} catch {
			// An invalid original file must still be repairable.
		}
	}

	const existing = new Map<string, number>();

	const key_for = (item: NamingViolation) =>
		`${item.category}:${item.name}`;

	for (const item of old_violations) {
		const key = key_for(item);
		existing.set(key, (existing.get(key) ?? 0) + 1);
	}

	for (const item of violations_in(path, content, config)) {
		const key = key_for(item);
		const remaining = existing.get(key) ?? 0;

		if (remaining) {
			existing.set(key, remaining - 1);
			continue;
		}

		const prefix = content.slice(0, item.position);
		const line = prefix.split('\n').length;
		const column = item.position - prefix.lastIndexOf('\n');
		throw new Error(
			`Blocked by coding preferences: ${path}:${line}:${column}: ${item.category} declaration "${item.name}" must use ${item.style}. File was not written. [rule: naming.${item.category}]`,
		);
	}
}
