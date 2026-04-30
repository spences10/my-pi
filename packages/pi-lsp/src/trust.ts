import {
	is_project_subject_trusted,
	read_project_trust_store,
	trust_project_subject,
	type ProjectTrustSubject,
} from '@spences10/pi-project-trust';
import { homedir } from 'node:os';
import { join } from 'node:path';

const LSP_PROJECT_BINARY_ENV = 'MY_PI_LSP_PROJECT_BINARY';

export function default_lsp_trust_store_path(): string {
	return join(homedir(), '.pi', 'agent', 'trusted-lsp-binaries.json');
}

export function create_lsp_binary_trust_subject(
	binary_path: string,
): ProjectTrustSubject {
	return {
		kind: 'lsp-binary',
		id: binary_path,
		store_key: binary_path,
		env_key: LSP_PROJECT_BINARY_ENV,
		prompt_title: 'Trust project-local LSP binary?',
		fallback: 'global',
		choices: {
			allow_once: 'Allow once for this session',
			trust: 'Trust this binary path',
			skip: 'Use global PATH binary instead',
		},
	};
}

export function is_lsp_binary_trusted(
	binary_path: string,
	trust_store_path = default_lsp_trust_store_path(),
): boolean {
	const subject = create_lsp_binary_trust_subject(binary_path);
	if (is_project_subject_trusted(subject, trust_store_path))
		return true;

	const entry = read_project_trust_store(trust_store_path)[
		binary_path
	] as { binary_path?: unknown } | undefined;
	return entry?.binary_path === binary_path;
}

export function trust_lsp_binary(
	binary_path: string,
	trust_store_path = default_lsp_trust_store_path(),
): void {
	trust_project_subject(
		create_lsp_binary_trust_subject(binary_path),
		trust_store_path,
	);
}
