import { describe, expect, it } from 'vite-plus/test';
import { get_default_telemetry_export_path } from './ui.js';

describe('packages/pi-telemetry/src/ui.ts', () => {
	it('creates JSON export paths under the cwd', () => {
		const path = get_default_telemetry_export_path('/repo');
		expect(path).toMatch(/^\/repo\/telemetry-export-.*\.json$/);
	});
});
