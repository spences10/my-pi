export { default } from './extension.js';

export {
	IMPORT_METADATA_FILE,
	is_importable_skill,
	is_imported_skill,
	scan_importable_skills,
	scan_imported_skills,
	scan_managed_skills,
	type DiscoveredSkill,
	type ImportableSkill,
	type ImportedSkill,
	type ImportedSkillMetadata,
	type InstalledPlugin,
	type PluginSkillSource,
	type SkillScope,
} from './scanner.js';

export {
	dedupe_skills_by_path,
	find_project_roots,
	scan_skill_directory,
	type ScanSkillDirectoryOptions,
	type ScannedSkill,
} from './scanner-primitives.js';

export {
	delete_managed_skill as delete_imported_skill,
	get_imported_skill_sync_status,
	import_external_skill,
	sync_imported_skill,
	validate_imported_skill_name,
	type DeleteSkillResult,
	type ImportedSkillSyncStatus,
	type ImportSkillResult,
	type SyncSkillResult,
} from './importer.js';
