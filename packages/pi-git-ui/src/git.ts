export {
	build_line_patch,
	changed_line_indexes,
	parse_diff_hunks,
	read_diff,
	stage_hunk,
	stage_line,
	unstage_hunk,
	unstage_line,
} from './git/diff.js';

export { format_git_error } from './git/errors.js';

export {
	commit,
	discard_file,
	git_path,
	stage_all,
	stage_file,
	toggle_file,
	unstage_all,
	unstage_file,
} from './git/operations.js';

export { read_repo_overview } from './git/overview.js';

export {
	has_staged_changes,
	parse_porcelain_z,
	read_status,
	staged_file_count,
} from './git/status.js';

export { EMPTY_STATUS } from './git/types.js';

export type {
	DiffHunk,
	DiffSection,
	DiffView,
	FileState,
	GitFile,
	GitStatus,
	RepoOverview,
} from './git/types.js';
