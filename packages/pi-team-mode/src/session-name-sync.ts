interface SessionInfoChangedSource {
	on(
		event: 'session_info_changed',
		handler: (event: { name: string | undefined }) => void,
	): void;
}

interface SessionNameStore {
	update_session_agent_name(
		session_id: string,
		agent_name: string | undefined,
	): void;
}

export function register_session_name_sync(
	pi: SessionInfoChangedSource,
	db: SessionNameStore,
	get_session_id: () => string | undefined,
	fallback_agent_name: string | undefined,
): void {
	pi.on('session_info_changed', (event) => {
		const session_id = get_session_id();
		if (!session_id) return;
		db.update_session_agent_name(
			session_id,
			event.name || fallback_agent_name,
		);
	});
}
