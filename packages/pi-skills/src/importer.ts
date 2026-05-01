import { getAgentDir } from '@mariozechner/pi-coding-agent';
import { createHash } from 'node:crypto';
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import {
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
} from 'node:path';
import {
	IMPORT_METADATA_FILE,
	type DiscoveredSkill,
	type ImportedSkillMetadata,
} from './scanner.js';

const IMPORT_METADATA_VERSION = 1;

function get_managed_skills_dir(): string {
	return join(getAgentDir(), 'skills');
}

function ensure_dir(path: string): void {
	mkdirSync(path, { recursive: true, mode: 0o700 });
}

function list_files_recursively(dir: string): string[] {
	const files: string[] = [];

	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full_path = join(dir, entry.name);
		if (entry.name === IMPORT_METADATA_FILE) continue;
		if (entry.isDirectory()) {
			files.push(...list_files_recursively(full_path));
			continue;
		}
		if (entry.isFile()) {
			files.push(full_path);
		}
	}

	return files.sort((a, b) => a.localeCompare(b));
}

function hash_directory(dir: string): string {
	const hash = createHash('sha256');
	for (const file of list_files_recursively(dir)) {
		hash.update(relative(dir, file));
		hash.update('\0');
		hash.update(readFileSync(file));
		hash.update('\0');
	}
	return hash.digest('hex');
}

function read_metadata(
	base_dir: string,
): ImportedSkillMetadata | undefined {
	const path = join(base_dir, IMPORT_METADATA_FILE);
	if (!existsSync(path)) return undefined;

	try {
		return JSON.parse(
			readFileSync(path, 'utf-8'),
		) as ImportedSkillMetadata;
	} catch {
		return undefined;
	}
}

function write_metadata(
	base_dir: string,
	metadata: ImportedSkillMetadata,
): void {
	writeFileSync(
		join(base_dir, IMPORT_METADATA_FILE),
		JSON.stringify(metadata, null, '\t') + '\n',
		{ mode: 0o600 },
	);
}

function has_control_character(value: string): boolean {
	return Array.from(value).some((char) => {
		const code = char.codePointAt(0) ?? 0;
		return code < 0x20 || code === 0x7f;
	});
}

export function validate_imported_skill_name(name: string): string {
	if (!name.trim()) {
		throw new Error('Skill name must not be empty');
	}
	if (name !== name.trim()) {
		throw new Error(
			`Invalid skill name "${name}": leading or trailing whitespace is not allowed`,
		);
	}
	if (
		name === '.' ||
		name === '..' ||
		isAbsolute(name) ||
		/[\\/]/.test(name) ||
		has_control_character(name)
	) {
		throw new Error(
			`Invalid skill name "${name}": must be a single safe path segment`,
		);
	}
	return name;
}

function resolve_managed_skill_dir(
	managed_root: string,
	name: string,
): string {
	const safe_name = validate_imported_skill_name(name);
	const skill_dir = resolve(managed_root, safe_name);
	const relative_path = relative(managed_root, skill_dir);
	if (
		!relative_path ||
		relative_path.startsWith('..') ||
		isAbsolute(relative_path)
	) {
		throw new Error(
			`Invalid skill name "${name}": destination escapes managed skills directory`,
		);
	}
	return skill_dir;
}

function replace_directory(
	source_dir: string,
	dest_dir: string,
): void {
	const parent_dir = dirname(dest_dir);
	ensure_dir(parent_dir);
	const tmp_dir = join(
		parent_dir,
		`.${resolve(dest_dir).split('/').pop()}.tmp-${Date.now()}`,
	);

	rmSync(tmp_dir, { recursive: true, force: true });
	cpSync(source_dir, tmp_dir, {
		recursive: true,
		preserveTimestamps: true,
		verbatimSymlinks: false,
	});
	rmSync(dest_dir, { recursive: true, force: true });
	cpSync(tmp_dir, dest_dir, {
		recursive: true,
		preserveTimestamps: true,
		verbatimSymlinks: false,
	});
	rmSync(tmp_dir, { recursive: true, force: true });
}

export interface ImportSkillResult {
	skillDir: string;
	metadata: ImportedSkillMetadata;
}

export function import_external_skill(
	skill: DiscoveredSkill,
): ImportSkillResult {
	if (skill.kind !== 'external') {
		throw new Error(`Skill ${skill.name} is not importable`);
	}

	const managed_root = get_managed_skills_dir();
	ensure_dir(managed_root);

	const skill_dir = resolve_managed_skill_dir(
		managed_root,
		skill.name,
	);
	const existing = existsSync(skill_dir);
	if (existing) {
		const existing_stat = statSync(skill_dir);
		if (!existing_stat.isDirectory()) {
			throw new Error(`${skill_dir} exists and is not a directory`);
		}

		const existing_metadata = read_metadata(skill_dir);
		if (!existing_metadata) {
			throw new Error(
				`Refusing to overwrite existing unmanaged skill at ${skill_dir}`,
			);
		}
	}

	replace_directory(skill.baseDir, skill_dir);

	const upstream_hash = hash_directory(skill.baseDir);
	const imported_hash = hash_directory(skill_dir);
	const now = new Date().toISOString();
	const metadata: ImportedSkillMetadata = {
		version: IMPORT_METADATA_VERSION,
		source: skill.source,
		upstream_skill_path: skill.skillPath,
		upstream_base_dir: skill.baseDir,
		upstream_install_path: skill.plugin?.installPath,
		upstream_version: skill.plugin?.version,
		upstream_git_commit_sha: skill.plugin?.gitCommitSha,
		imported_at: now,
		last_synced_at: now,
		imported_hash,
		upstream_hash,
	};

	write_metadata(skill_dir, metadata);
	return {
		skillDir: skill_dir,
		metadata,
	};
}

export interface SyncSkillResult {
	skillDir: string;
	metadata: ImportedSkillMetadata;
	changed: boolean;
}

export function sync_imported_skill(
	skill: DiscoveredSkill,
): SyncSkillResult {
	if (skill.kind !== 'managed' || !skill.import_meta) {
		throw new Error(
			`Skill ${skill.name} is not managed by my-pi sync`,
		);
	}

	const metadata = skill.import_meta;
	if (!existsSync(metadata.upstream_base_dir)) {
		throw new Error(
			`Upstream source no longer exists: ${metadata.upstream_base_dir}`,
		);
	}

	const current_hash = hash_directory(skill.baseDir);
	if (current_hash !== metadata.imported_hash) {
		throw new Error(
			`Refusing to sync ${skill.name}; local changes detected in ${skill.baseDir}`,
		);
	}

	const upstream_hash = hash_directory(metadata.upstream_base_dir);
	if (upstream_hash === metadata.upstream_hash) {
		return {
			skillDir: skill.baseDir,
			metadata,
			changed: false,
		};
	}

	replace_directory(metadata.upstream_base_dir, skill.baseDir);
	const imported_hash = hash_directory(skill.baseDir);
	const updated: ImportedSkillMetadata = {
		...metadata,
		last_synced_at: new Date().toISOString(),
		imported_hash,
		upstream_hash,
	};
	write_metadata(skill.baseDir, updated);

	return {
		skillDir: skill.baseDir,
		metadata: updated,
		changed: true,
	};
}
