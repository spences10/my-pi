import {
	createEditToolDefinition,
	createWriteToolDefinition,
	type ExtensionAPI,
} from '@earendil-works/pi-coding-agent';
import { constants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import {
	assert_naming,
	resolve_naming_config,
	supports_naming,
	type NamingConfig,
} from './naming.js';

export function register_guarded_tools(
	pi: ExtensionAPI,
	get_config: (cwd: string) => NamingConfig | false | undefined,
): void {
	function checked_writer(cwd: string) {
		const config = resolve_naming_config(get_config(cwd));
		return async (path: string, content: string) => {
			if (config && supports_naming(path)) {
				let previous: string | undefined;
				try {
					previous = await readFile(path, 'utf8');
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
						throw error;
				}
				assert_naming(path, content, previous, config);
			}
			await writeFile(path, content, 'utf8');
		};
	}
	const cwd = process.cwd();
	pi.registerTool({
		...createWriteToolDefinition(cwd),
		execute(...args) {
			const current_cwd = args[4].cwd;
			return createWriteToolDefinition(current_cwd, {
				operations: {
					mkdir: async (dir) => {
						await mkdir(dir, { recursive: true });
					},
					writeFile: checked_writer(current_cwd),
				},
			}).execute(...args);
		},
	});
	pi.registerTool({
		...createEditToolDefinition(cwd),
		execute(...args) {
			const current_cwd = args[4].cwd;
			return createEditToolDefinition(current_cwd, {
				operations: {
					readFile,
					access: (path) =>
						access(path, constants.R_OK | constants.W_OK),
					writeFile: checked_writer(current_cwd),
				},
			}).execute(...args);
		},
	});
}
