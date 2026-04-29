import { create_child_process_env as create_shared_child_process_env } from '@spences10/pi-child-env';

export function create_child_process_env(
	explicit_env: Record<string, string> = {},
	source_env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	return create_shared_child_process_env({
		profile: 'mcp',
		explicit_env,
		source_env,
	});
}
