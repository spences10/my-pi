import type { DashboardSession } from '../../../types';
import { api } from './api.js';

/** Recent sessions for the sidebar, refreshed by live events. */
class RecentSessions {
	list = $state.raw<DashboardSession[]>([]);
	error = $state<string | null>(null);

	async load(): Promise<void> {
		try {
			this.list = (await api.sessions(60)).sessions;
			this.error = null;
		} catch (caught) {
			this.error =
				caught instanceof Error ? caught.message : String(caught);
		}
	}
}

export const recent_sessions = new RecentSessions();
