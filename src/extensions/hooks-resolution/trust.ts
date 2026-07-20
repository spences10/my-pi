import {
	create_project_trust_wrapper,
	type ProjectTrustSubject,
} from '@spences10/pi-project-trust';

const HOOKS_CONFIG_ENV = 'MY_PI_HOOKS_CONFIG';

const hooks_config_trust = create_project_trust_wrapper({
	store_filename: 'trusted-hooks.json',
	legacy_matcher: (entry, subject) => {
		const legacy_entry = entry as
			| { project_dir?: unknown; hash?: unknown }
			| undefined;
		return (
			legacy_entry?.project_dir === subject.id &&
			legacy_entry.hash === subject.hash
		);
	},
});

export function default_hooks_trust_store_path(): string {
	return hooks_config_trust.default_trust_store_path();
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
	return hooks_config_trust.is_trusted(
		create_hooks_config_trust_subject(project_dir, hash),
		trust_store_path,
	);
}

export function trust_hooks_config(
	project_dir: string,
	hash: string,
	trust_store_path = default_hooks_trust_store_path(),
): void {
	hooks_config_trust.trust(
		create_hooks_config_trust_subject(project_dir, hash),
		trust_store_path,
	);
}
