import { getAgentDir } from '@mariozechner/pi-coding-agent';
import {
	is_project_subject_trusted,
	read_project_trust_store,
	trust_project_subject,
	type ProjectTrustSubject,
} from '@spences10/pi-project-trust';
import { join } from 'node:path';

const HOOKS_CONFIG_ENV = 'MY_PI_HOOKS_CONFIG';

export function default_hooks_trust_store_path(): string {
	return join(getAgentDir(), 'trusted-hooks.json');
}

export function create_hooks_config_trust_subject(
	project_dir: string,
	hash: string,
): ProjectTrustSubject {
	return {
		kind: 'hooks-config',
		id: project_dir,
		store_key: project_dir,
		hash,
		env_key: HOOKS_CONFIG_ENV,
		prompt_title:
			'Project hook config can execute shell commands after tool use. Trust these hooks?',
	};
}

export function is_hooks_config_trusted(
	project_dir: string,
	hash: string,
	trust_store_path = default_hooks_trust_store_path(),
): boolean {
	const subject = create_hooks_config_trust_subject(
		project_dir,
		hash,
	);
	if (is_project_subject_trusted(subject, trust_store_path))
		return true;

	const legacy_entry = read_project_trust_store(trust_store_path)[
		project_dir
	] as { project_dir?: unknown; hash?: unknown } | undefined;
	return (
		legacy_entry?.project_dir === project_dir &&
		legacy_entry.hash === hash
	);
}

export function trust_hooks_config(
	project_dir: string,
	hash: string,
	trust_store_path = default_hooks_trust_store_path(),
): void {
	trust_project_subject(
		create_hooks_config_trust_subject(project_dir, hash),
		trust_store_path,
	);
}
