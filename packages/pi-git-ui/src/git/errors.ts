export function format_git_error(cause: unknown): string {
	const message =
		cause instanceof Error ? cause.message : String(cause);

	if (message.includes('No staged changes'))
		return 'No staged changes to commit.';

	if (message.includes('nothing to commit'))
		return 'Nothing to commit.';

	if (message.includes('patch does not apply')) {
		return 'Hunk no longer applies. Refresh and try again.';
	}

	if (message.includes('CONFLICT')) {
		return 'Git conflict detected. Resolve conflict markers, then stage the file.';
	}

	if (message.includes('not a git repository'))
		return 'Not inside a Git repository.';

	return message;
}
