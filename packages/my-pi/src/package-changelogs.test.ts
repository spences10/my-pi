import {
	DefaultResourceLoader,
	SettingsManager,
} from '@earendil-works/pi-coding-agent';
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vite-plus/test';

const package_root = fileURLToPath(new URL('../', import.meta.url));
const agent_dirs: string[] = [];

afterEach(() => {
	for (const dir of agent_dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

describe('package changelog delivery', () => {
	it('ships the changelog in every published package with release notes', () => {
		const packages_dir = join(package_root, '..');
		for (const dir of readdirSync(packages_dir)) {
			const root = join(packages_dir, dir);
			if (!existsSync(join(root, 'CHANGELOG.md'))) continue;
			const manifest = JSON.parse(
				readFileSync(join(root, 'package.json'), 'utf8'),
			);
			if (manifest.private) continue;
			expect(manifest.files, manifest.name).toContain('CHANGELOG.md');
		}
	});

	it('discovers installed extension changelogs through the upstream package loader', async () => {
		const agent_dir = mkdtempSync(join(tmpdir(), 'my-pi-changelog-'));
		agent_dirs.push(agent_dir);
		const root = fileURLToPath(
			new URL('../../pi-team-mode/', import.meta.url),
		);
		const loader = new DefaultResourceLoader({
			cwd: agent_dir,
			agentDir: agent_dir,
			noContextFiles: true,
			settingsManager: SettingsManager.inMemory({ packages: [root] }),
		});
		await loader.reload();
		const loaded = loader.getExtensions();
		expect(loaded.errors).toEqual([]);
		expect(loaded.extensions).toHaveLength(1);
		expect(loaded.extensions[0]!.sourceInfo).toMatchObject({
			origin: 'package',
			baseDir: root.replace(/\/$/, ''),
			changelogPath: join(root, 'CHANGELOG.md'),
		});
	});
});
