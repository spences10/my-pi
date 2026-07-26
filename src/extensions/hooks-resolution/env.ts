import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import {
	create_pi_session_env,
	create_child_process_env as create_shared_child_process_env,
} from '@spences10/pi-child-env';

export function create_hook_session_env(
	ctx: ExtensionContext,
): Record<string, string> {
	return create_pi_session_env({
		session_id: ctx.sessionManager.getSessionId(),
		session_file: ctx.sessionManager.getSessionFile(),
		provider: ctx.model?.provider,
		model: ctx.model?.id,
		reasoning_level: ctx.thinkingLevel,
	});
}

export function create_child_process_env(
	explicit_env: Record<string, string> = {},
	source_env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	return create_shared_child_process_env({
		profile: 'hooks',
		explicit_env,
		source_env,
	});
}
