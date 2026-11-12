import type { TelemetryStore } from './types.js';

export async function default_load_store(
	db_path: string,
): Promise<TelemetryStore> {
	const { TelemetryDatabase } = await import('./db.js');

	return TelemetryDatabase.open(db_path);
}
