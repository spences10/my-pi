#!/usr/bin/env node
import {
	main,
	type InlineExtension,
} from '@earendil-works/pi-coding-agent';
import { EXTENSIONS, themes_dir } from './extensions.js';
import extensions_manager from './manager.js';
import { is_enabled } from './settings.js';

process.title = 'my-pi';
process.env.PI_CODING_AGENT = 'true';
process.env.AI_AGENT = 'pi';
// my-pi pins its Pi version, so upstream's update notice does not apply.
process.env.PI_SKIP_VERSION_CHECK ??= '1';
// Same as upstream's CLI: hides node:sqlite's ExperimentalWarning.
process.emitWarning = () => {};

// Each factory checks the saved setting when Pi (re)loads extensions,
// so /extensions changes apply on /reload without a restart.
const extensions: InlineExtension[] = [
	{ name: 'extensions', factory: extensions_manager },
	...EXTENSIONS.map((extension) => ({
		name: extension.key,
		factory: async (pi: Parameters<typeof extensions_manager>[0]) => {
			if (!is_enabled(extension.key)) return;
			await (
				await extension.load()
			)(pi);
		},
	})),
];

// Pi reads these subcommands from the first argument.
const subcommands = new Set([
	'auth',
	'config',
	'install',
	'list',
	'mcp',
	'remove',
	'uninstall',
	'update',
]);
const args = process.argv.slice(2);
const theme_args =
	is_enabled('themes') && !subcommands.has(args[0])
		? ['--theme', themes_dir()]
		: [];

await main([...theme_args, ...args], {
	extensionFactories: extensions,
});
