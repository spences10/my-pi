import type {
	ExtensionFactory,
	InlineExtension,
	LoadExtensionsResult,
} from '@earendil-works/pi-coding-agent';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import {
	BUILTIN_EXTENSION_REGISTRY,
	type BuiltinExtensionKey,
} from '../extensions/builtin-registry.js';
import {
	is_builtin_extension_active,
	load_builtin_extensions_config,
} from '../extensions/manager/config.js';
import type {
	BuiltinExtensionOptions,
	CreateMyPiOptions,
	MyPiRuntimeMode,
} from './options.js';

type BuiltinExtensionLoader = () => Promise<ExtensionFactory>;

const require = createRequire(import.meta.url);
export const PACKAGE_THEME_DIR = resolve(
	dirname(require.resolve('@spences10/pi-themes/package.json')),
	'themes',
);

export const MANAGED_INLINE_EXTENSION_NAME_PREFIX = 'my-pi-';

export function assert_unreserved_inline_extension_names(
	extensions: readonly InlineExtension[],
): void {
	for (const extension of extensions) {
		if (
			typeof extension !== 'function' &&
			extension.name.startsWith(MANAGED_INLINE_EXTENSION_NAME_PREFIX)
		) {
			throw new Error(
				`Inline extension name "${extension.name}" is reserved for my-pi managed extensions; choose a name that does not start with "${MANAGED_INLINE_EXTENSION_NAME_PREFIX}".`,
			);
		}
	}
}

export function get_force_disabled_builtins(
	options: Pick<CreateMyPiOptions, 'runtime_mode'> &
		BuiltinExtensionOptions,
): Set<BuiltinExtensionKey> {
	const force_disabled = new Set<BuiltinExtensionKey>();
	for (const extension of BUILTIN_EXTENSION_REGISTRY) {
		const enabled =
			options[extension.option_name] ?? extension.default_enabled;
		if (!enabled) force_disabled.add(extension.key);
		const disabled_in =
			'mode_constraints' in extension
				? extension.mode_constraints.disabled_in
				: undefined;
		if (
			options.runtime_mode &&
			(
				disabled_in as readonly MyPiRuntimeMode[] | undefined
			)?.includes(options.runtime_mode)
		) {
			force_disabled.add(extension.key);
		}
	}
	return force_disabled;
}

function is_agent_dir_package_installed(
	agent_dir: string,
	package_name: string,
): boolean {
	return existsSync(
		join(agent_dir, 'npm', 'node_modules', package_name),
	);
}

export function get_externally_installed_builtin_extensions(
	agent_dir: string,
): Set<BuiltinExtensionKey> {
	const installed = new Set<BuiltinExtensionKey>();
	for (const extension of BUILTIN_EXTENSION_REGISTRY) {
		const external_package_name = (
			extension as { external_package_name?: string }
		).external_package_name;
		if (
			external_package_name &&
			is_agent_dir_package_installed(agent_dir, external_package_name)
		) {
			installed.add(extension.key);
		}
	}
	return installed;
}

export function warn_builtin_extension_unavailable(
	key: BuiltinExtensionKey | 'telemetry',
	error: unknown,
): void {
	const reason =
		error instanceof Error ? error.message : String(error);
	process.emitWarning(
		`Built-in extension "${key}" is unavailable and was skipped: ${reason}`,
		{ code: 'MY_PI_BUILTIN_EXTENSION_UNAVAILABLE' },
	);
}

export function create_lazy_builtin_extension_factory(
	key: BuiltinExtensionKey,
	load_extension: BuiltinExtensionLoader,
	force_disabled: ReadonlySet<BuiltinExtensionKey>,
): ExtensionFactory {
	return async (pi) => {
		const config = load_builtin_extensions_config();
		if (!is_builtin_extension_active(config, key, force_disabled)) {
			return;
		}
		try {
			const extension = await load_extension();
			await extension(pi);
		} catch (error) {
			warn_builtin_extension_unavailable(key, error);
		}
	};
}

export function create_lazy_telemetry_extension(options: {
	enabled?: boolean;
	db_path?: string;
	cwd?: string;
}): ExtensionFactory {
	return async (pi) => {
		try {
			const { create_telemetry_extension } =
				await import('@spences10/pi-telemetry');
			await create_telemetry_extension(options)(pi);
		} catch (error) {
			warn_builtin_extension_unavailable('telemetry', error);
		}
	};
}

export function create_extensions_override(
	managed_extension_paths: readonly string[],
): (base: LoadExtensionsResult) => LoadExtensionsResult {
	return (base) => {
		// Pi names inline extensions but still loads discovered paths first.
		// Move only the first matching managed instance to preserve precedence.
		const remaining = [...base.extensions];
		const ordered_managed = managed_extension_paths.flatMap(
			(path) => {
				const index = remaining.findIndex(
					(extension) => extension.path === path,
				);
				return index === -1 ? [] : remaining.splice(index, 1);
			},
		);
		return {
			...base,
			extensions: [...ordered_managed, ...remaining],
		};
	};
}
