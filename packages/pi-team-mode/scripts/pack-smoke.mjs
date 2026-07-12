import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const package_root = fileURLToPath(new URL('..', import.meta.url));
const temp_root = mkdtempSync(join(tmpdir(), 'pi-team-mode-pack-'));
const stale_path = join(
	package_root,
	'dist',
	'__pack_smoke_stale__.js',
);
const forbidden_paths = [
	/^dist\/(?:rpc(?:\/|-runner)|runner-orchestration|headless-runner|runtime)(?:\.|\/)/,
	/^dist\/(?:child-env|diagnostics|process-identity|spawn-limits|visible-sessions|workspace-policy)(?:\.|\/)/,
	/^dist\/store(?:\.|\/)/,
	/^dist\/commands\/(?:runner|task|team|message)-commands(?:\.|\/)/,
	/^dist\/workspace(?:\.|\/)/,
	/^dist\/schema\.sql$/,
	/^dist\/__pack_smoke_stale__\.js$/,
];

function run(command, args) {
	return execFileSync(command, args, {
		cwd: package_root,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});
}

function build() {
	run('pnpm', ['run', 'build:self']);
}

function pack(destination) {
	mkdirSync(destination, { recursive: true });
	run('npm', [
		'pack',
		'--ignore-scripts',
		'--pack-destination',
		destination,
	]);
	const tarballs = readdirSync(destination).filter((name) =>
		name.endsWith('.tgz'),
	);
	if (tarballs.length !== 1) {
		throw new Error(`expected one tarball, found ${tarballs.length}`);
	}
	return join(destination, tarballs[0]);
}

function entries(tarball) {
	return run('tar', ['-tzf', tarball])
		.split('\n')
		.filter(Boolean)
		.map((entry) =>
			entry.replace(/^package\//, '').replace(/\/$/, ''),
		)
		.sort();
}

try {
	build();
	const clean_entries = entries(pack(join(temp_root, 'clean')));

	writeFileSync(
		stale_path,
		'throw new Error("stale dist output was packed");\n',
	);
	build();
	if (existsSync(stale_path)) {
		throw new Error(
			'build:self did not remove the stale dist sentinel',
		);
	}

	const dirty_entries = entries(pack(join(temp_root, 'dirty')));
	if (
		JSON.stringify(clean_entries) !== JSON.stringify(dirty_entries)
	) {
		throw new Error(
			'clean and stale-seeded builds produced different pack file lists',
		);
	}

	const forbidden = dirty_entries.filter((entry) =>
		forbidden_paths.some((pattern) => pattern.test(entry)),
	);
	if (forbidden.length > 0) {
		throw new Error(
			`forbidden legacy paths were packed:\n${forbidden.join('\n')}`,
		);
	}

	console.log(
		`pack smoke passed: ${dirty_entries.length} identical entries; no forbidden legacy paths`,
	);
} finally {
	rmSync(stale_path, { force: true });
	rmSync(temp_root, { recursive: true, force: true });
}
