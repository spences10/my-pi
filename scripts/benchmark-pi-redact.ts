#!/usr/bin/env node
/// <reference types="node" />
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import * as v from 'valibot';

// All fixtures are invented, fixed strings, never environment values.
const exact_values = Array.from(
	{ length: 32 },
	(_, index) =>
		`fixture-opaque-${String(index).padStart(3, '0')}-!$%&-value`,
);

const github = `ghp_${'Ab3d'.repeat(9)}`;
const normal_line = `INFO build completed: 42 modules in 128ms\nDEBUG diagnostic ${exact_values[0]}\nGITHUB_TOKEN=${github}\n`;

const patterns = {
	hex: '16f3a8b92c4d570e',
	eyJ: 'eyJ',
	whitespace: '\n',
	dotted: 'a.',
	pem_headers: '-----BEGIN ',
	source: 'export const item = queue.shift();\n',
	normal: normal_line,
};

type FixtureKind = keyof typeof patterns;

interface Fixture {
	kind: FixtureKind;
	bytes: number;
}

interface SecretCase {
	id: string;
	input: string;
	value: string;
}

const opaque = 'Cedar9!Quartz$River%71';

const secret_cases: SecretCase[] = [
	{ id: 'github', input: `result: ${github}`, value: github },
	{ id: 'env', input: `PASSWORD=${opaque}`, value: opaque },
	{
		id: 'json',
		input: JSON.stringify({ password: opaque }),
		value: opaque,
	},
	{ id: 'toml', input: `service_token = "${opaque}"`, value: opaque },
	{ id: 'short-password', input: 'password=abc123', value: 'abc123' },
	{
		id: 'url',
		input: `https://alice:${opaque}@example.invalid/`,
		value: opaque,
	},
	{
		id: 'bearer',
		input: 'Bearer SYNTHETIC1234567890123456789',
		value: 'SYNTHETIC1234567890123456789',
	},
	{
		id: 'slack',
		input: `xoxb-${'Ab3d'.repeat(8)}`,
		value: `xoxb-${'Ab3d'.repeat(8)}`,
	},
	{
		id: 'private-key',
		input:
			'-----BEGIN PRIVATE KEY-----\nU1lOVEhFVElDX09OTFk=\n-----END PRIVATE KEY-----',
		value: 'U1lOVEhFVElDX09OTFk=',
	},
	{ id: 'unlabelled', input: `diagnostic ${opaque}`, value: opaque },
	{
		id: 'base64',
		input: `diagnostic ${Buffer.from(opaque).toString('base64')}`,
		value: Buffer.from(opaque).toString('base64'),
	},
	{
		id: 'url-encoded',
		input: `diagnostic ${encodeURIComponent(opaque)}`,
		value: encodeURIComponent(opaque),
	},
];

const benign_cases = [
	'const token = tokens[index];',
	'const password = getPassword();',
	'const secret = config.secret;',
	'const api_key = process.env.API_KEY;',
	'let token: TokenEnvelope;',
	'const password = "example-password";',
	'password=********',
	'password=[REDACTED:Generic Password Field]',
	'Use `-----BEGIN PRIVATE KEY-----` to recognize a PEM header.',
	'const path = "docs/sk-this-is-a-documentation-example.md";',
	'const digest = "16f3a8b92c4d570e";',
	'export const item = queue.shift();',
];

const registry_schema = v.object({
	version: v.string(),
	dist: v.object({
		tarball: v.string(),
		integrity: v.string(),
		shasum: v.string(),
	}),
	time: v.record(v.string(), v.string()),
});

const package_schema = v.object({
	name: v.string(),
	version: v.string(),
});

const timing_schema = v.object({
	samples_ms: v.array(v.number()),
	median_ms: v.number(),
	redactions: v.number(),
	output_bytes: v.number(),
});

const corpus_schema = v.object({
	secrets: v.array(v.object({ id: v.string(), masked: v.boolean() })),
	benign: v.array(
		v.object({ input: v.string(), changed: v.boolean() }),
	),
	idempotence_failures: v.array(v.string()),
});

const child_job_schema = v.object({
	entry: v.string(),
	kind: v.picklist([
		'hex',
		'eyJ',
		'whitespace',
		'dotted',
		'pem_headers',
		'source',
		'normal',
	]),
	bytes: v.number(),
	samples: v.number(),
	iterations: v.number(),
	exact: v.boolean(),
	corpus: v.boolean(),
});

type ChildJob = v.InferOutput<typeof child_job_schema>;

type Timing = v.InferOutput<typeof timing_schema>;

type Corpus = v.InferOutput<typeof corpus_schema>;

type Measurement<T> =
	| { status: 'ok'; result: T }
	| { status: 'timeout'; process_timeout_ms: number };

interface RedactModule {
	redact_text: (
		text: string,
		options?: { known_values: readonly string[] },
	) => { redacted: string; count: number };
}

const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), '..');

function hash(data: string | Buffer): string {
	return createHash('sha256').update(data).digest('hex');
}

function input_for(fixture: Fixture): string {
	const pattern = patterns[fixture.kind];

	return pattern
		.repeat(Math.ceil(fixture.bytes / pattern.length))
		.slice(0, fixture.bytes);
}

function command(
	executable: string,
	args: string[],
	cwd: string,
): string {
	const result = spawnSync(executable, args, {
		cwd,
		encoding: 'utf8',
		timeout: 120_000,
		maxBuffer: 4 * 1024 * 1024,
	});

	if (result.error || result.status !== 0) {
		throw new Error(
			`${executable} ${args.join(' ')} failed: ${result.error?.message ?? result.stderr}`,
		);
	}

	return result.stdout;
}

function artifact_files(
	directory: string,
	prefix = '',
): { file: string; sha256: string }[] {
	const files: { file: string; sha256: string }[] = [];

	for (const entry of readdirSync(directory, {
		withFileTypes: true,
	}).sort((a, b) => a.name.localeCompare(b.name))) {
		const relative = join(prefix, entry.name);

		if (entry.isDirectory())
			files.push(
				...artifact_files(join(directory, entry.name), relative),
			);
		else if (entry.name.endsWith('.js'))
			files.push({
				file: relative,
				sha256: hash(readFileSync(join(directory, entry.name))),
			});
	}

	return files;
}

async function child(job: ChildJob): Promise<Timing | Corpus> {
	// Both artifacts expose this public function; its result is validated below.
	const module: RedactModule = await import(
		pathToFileURL(job.entry).href
	);

	const redact = (input: string) => {
		if (job.exact)
			return module.redact_text(input, {
				known_values: exact_values,
			});

		return module.redact_text(input);
	};

	if (job.corpus) {
		const idempotence_failures: string[] = [];

		const secrets = secret_cases.map(({ id, input, value }) => {
			const { redacted } = redact(input);

			if (redact(redacted).redacted !== redacted)
				idempotence_failures.push(id);

			return {
				id,
				masked:
					!redacted.includes(value) &&
					!redacted.includes(value.slice(-6)),
			};
		});

		const benign = benign_cases.map((input, index) => {
			const { redacted } = redact(input);

			if (redact(redacted).redacted !== redacted)
				idempotence_failures.push(`benign-${index}`);

			return { input, changed: input !== redacted };
		});

		return { secrets, benign, idempotence_failures };
	}

	const input = input_for(job);
	let output = redact(input); // One untimed warmup on the same fixture.
	const samples_ms: number[] = [];

	for (let sample = 0; sample < job.samples; sample++) {
		const started = performance.now();

		for (let iteration = 0; iteration < job.iterations; iteration++)
			output = redact(input);
		samples_ms.push((performance.now() - started) / job.iterations);
	}

	if (
		job.exact &&
		job.kind === 'normal' &&
		output.redacted.includes(exact_values[0])
	)
		throw new Error(
			'Local artifact does not mask the registered synthetic value',
		);

	const sorted = [...samples_ms].sort((a, b) => a - b);

	return {
		samples_ms,
		median_ms:
			(sorted[Math.floor((sorted.length - 1) / 2)] +
				sorted[Math.floor(sorted.length / 2)]) /
			2,
		redactions: output.count,
		output_bytes: Buffer.byteLength(output.redacted),
	};
}

function measure<T>(
	job: ChildJob,
	timeout_ms: number,
	schema: v.GenericSchema<unknown, T>,
): Measurement<T> {
	const result = spawnSync(
		process.execPath,
		[script, '--child', JSON.stringify(job)],
		{
			encoding: 'utf8',
			timeout: timeout_ms,
			killSignal: 'SIGKILL',
			maxBuffer: 1024 * 1024,
		},
	);

	if (
		result.error &&
		'code' in result.error &&
		result.error.code === 'ETIMEDOUT'
	)
		return { status: 'timeout', process_timeout_ms: timeout_ms };

	if (result.error || result.status !== 0)
		throw new Error(
			`Benchmark child failed: ${result.error?.message ?? result.stderr}`,
		);

	return {
		status: 'ok',
		result: v.parse(schema, JSON.parse(result.stdout)),
	};
}

function prepare_published(version: string) {
	const sandbox = mkdtempSync(join(tmpdir(), 'pi-redact-benchmark-'));

	const metadata = v.parse(
		registry_schema,
		JSON.parse(
			command(
				'npm',
				[
					'view',
					`@spences10/pi-redact@${version}`,
					'version',
					'dist',
					'time',
					'--json',
				],
				sandbox,
			),
		),
	);

	const published_at = metadata.time[metadata.version];

	const age_match = readFileSync(
		join(root, 'pnpm-workspace.yaml'),
		'utf8',
	).match(/^minimumReleaseAge:\s*(\d+)$/m);

	if (!age_match || !published_at)
		throw new Error('Cannot verify the workspace release-age policy');
	const minimum_release_age_minutes = Number(age_match[1]);

	if (
		!Number.isFinite(Date.parse(published_at)) ||
		Date.now() - Date.parse(published_at) <
			minimum_release_age_minutes * 60_000
	) {
		throw new Error(
			`Published ${metadata.version} has not passed minimumReleaseAge=${minimum_release_age_minutes}; retry later, do not bypass the policy`,
		);
	}

	const spec = `@spences10/pi-redact@${metadata.version}`;

	const packed = v.parse(
		v.array(v.object({ filename: v.string() })),
		JSON.parse(
			command(
				'npm',
				['pack', spec, '--ignore-scripts', '--json'],
				sandbox,
			),
		),
	);

	const filename = packed[0].filename;

	if (basename(filename) !== filename)
		throw new Error('Unexpected tarball filename');
	const tarball = readFileSync(join(sandbox, filename));
	const integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`;

	if (integrity !== metadata.dist.integrity)
		throw new Error('Registry tarball integrity mismatch');
	command('tar', ['-xzf', filename], sandbox);
	const entry = join(sandbox, 'package/dist/index.js');

	const manifest = v.parse(
		package_schema,
		JSON.parse(
			readFileSync(join(sandbox, 'package/package.json'), 'utf8'),
		),
	);

	if (
		manifest.name !== '@spences10/pi-redact' ||
		manifest.version !== metadata.version
	)
		throw new Error('Tarball package identity mismatch');
	// Only runtime dependencies are shared, never the benchmarked package code.
	symlinkSync(
		join(root, 'node_modules'),
		join(sandbox, 'package/node_modules'),
		'dir',
	);

	return {
		entry,
		metadata: {
			...manifest,
			...metadata.dist,
			published_at,
			minimum_release_age_minutes,
			download_command: `npm pack ${spec} --ignore-scripts --json`,
			extraction_command: `tar -xzf ${filename}`,
			files: artifact_files(dirname(entry)),
			dependency_setup:
				'Extracted tarball package/node_modules links to the checkout node_modules; no dependency install or package lifecycle scripts run.',
		},
	};
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			local: {
				type: 'string',
				default: 'packages/pi-redact/dist/index.js',
			},
			published: { type: 'string', default: 'latest' },
			out: { type: 'string' },
			'timeout-ms': { type: 'string', default: '5000' },
			samples: { type: 'string', default: '3' },
			child: { type: 'string' },
			help: { type: 'boolean', default: false },
		},
	});

	if (values.child) {
		console.log(
			JSON.stringify(
				await child(
					v.parse(child_job_schema, JSON.parse(values.child)),
				),
			),
		);

		return;
	}

	if (values.help) {
		console.log(
			'node scripts/benchmark-pi-redact.ts --out /tmp/pi-redact-results.json [--local packages/pi-redact/dist/index.js] [--published latest|VERSION] [--timeout-ms 5000] [--samples 3]',
		);

		return;
	}

	if (!values.out)
		throw new Error(
			'--out is required; keep generated reports outside source unless intentionally publishing them',
		);
	const samples = Number(values.samples);
	const timeout_ms = Number(values['timeout-ms']);

	if (
		!Number.isSafeInteger(samples) ||
		samples < 1 ||
		!Number.isSafeInteger(timeout_ms) ||
		timeout_ms < 1
	)
		throw new Error(
			'Use a positive integer sample count and timeout-ms',
		);
	const local_entry = resolve(values.local);
	const local_files = artifact_files(dirname(local_entry));

	const local_manifest = v.parse(
		package_schema,
		JSON.parse(
			readFileSync(
				join(dirname(local_entry), '../package.json'),
				'utf8',
			),
		),
	);

	const published = prepare_published(values.published);
	const fixtures: Fixture[] = [];

	for (const bytes of [8, 16, 32, 50, 200].map((kib) => kib * 1024)) {
		for (const kind of [
			'hex',
			'eyJ',
			'whitespace',
			'dotted',
			'pem_headers',
			'source',
		] as const)
			fixtures.push({ kind, bytes });
	}

	for (const bytes of [4, 50, 200].map((kib) => kib * 1024))
		fixtures.push({ kind: 'normal', bytes });

	const timings: {
		fixture: Fixture;
		variant: string;
		iterations: number;
		measurement: Measurement<Timing>;
	}[] = [];

	const detection: {
		variant: string;
		measurement: Measurement<Corpus>;
	}[] = [];

	const report = {
		format_version: 1,
		completed: false,
		generated_at: new Date().toISOString(),
		runtime: {
			node: process.version,
			platform: process.platform,
			arch: process.arch,
			cpu: cpus()[0]?.model,
			logical_cpus: cpus().length,
			load_average_start: loadavg(),
		},
		published: { requested: values.published, ...published.metadata },
		local: { ...local_manifest, files: local_files },
		shared_dependencies: {
			checkout_packages: [
				'valibot',
				'@earendil-works/pi-ai',
				'@earendil-works/pi-coding-agent',
			].map((name) =>
				v.parse(
					package_schema,
					JSON.parse(
						readFileSync(
							join(root, 'node_modules', name, 'package.json'),
							'utf8',
						),
					),
				),
			),
			lockfile_sha256: hash(
				readFileSync(join(root, 'pnpm-lock.yaml')),
			),
		},
		method: {
			samples,
			warmup_calls: 1,
			timeout_ms,
			timeout_scope:
				'entire child process: startup, import, warmup and all samples',
			exact_registry_size: exact_values.length,
			script_sha256: hash(readFileSync(script)),
			corpus_sha256: hash(
				JSON.stringify({
					patterns,
					secret_cases,
					benign_cases,
					exact_values,
				}),
			),
			timing:
				'milliseconds per redact_text call, excludes import, fixture construction, warmup and serialization',
		},
		timings,
		detection,
	};

	const save = () => {
		mkdirSync(dirname(resolve(values.out!)), { recursive: true });
		writeFileSync(
			values.out!,
			`${JSON.stringify(report, null, 2)}\n`,
		);
	};

	const job = (
		fixture: Fixture,
		entry: string,
		exact: boolean,
		corpus = false,
	): ChildJob => ({
		...fixture,
		entry,
		samples,
		iterations: fixture.kind === 'normal' ? 20 : 1,
		exact,
		corpus,
	});

	save();

	for (const [index, fixture] of fixtures.entries()) {
		const variants = [
			{ variant: 'published', entry: published.entry },
			{ variant: 'local', entry: local_entry },
		];

		if (index % 2) variants.reverse();

		for (const { variant, entry } of variants) {
			const request = job(fixture, entry, false);
			const measurement = measure(request, timeout_ms, timing_schema);
			timings.push({
				fixture,
				variant,
				iterations: request.iterations,
				measurement,
			});
			console.log(
				`${variant} ${fixture.kind} ${fixture.bytes / 1024}KiB: ${measurement.status === 'ok' ? `${measurement.result.median_ms.toFixed(3)}ms` : 'process timeout'}`,
			);
			save();
		}
	}

	// Separate local-only feature overhead, never a published-vs-local score.
	for (const fixture of [
		{ kind: 'source', bytes: 50 * 1024 },
		{ kind: 'source', bytes: 200 * 1024 },
		...fixtures.filter((item) => item.kind === 'normal'),
	] satisfies Fixture[]) {
		const request = job(fixture, local_entry, true);
		timings.push({
			fixture,
			variant: 'local-exact-32',
			iterations: request.iterations,
			measurement: measure(request, timeout_ms, timing_schema),
		});
		save();
	}

	for (const [variant, entry] of [
		['published', published.entry],
		['local', local_entry],
	]) {
		detection.push({
			variant,
			measurement: measure(
				job({ kind: 'source', bytes: 0 }, entry, false, true),
				timeout_ms,
				corpus_schema,
			),
		});
	}

	if (
		JSON.stringify(local_files) !==
		JSON.stringify(artifact_files(dirname(local_entry)))
	)
		throw new Error(
			'Local build changed during benchmarking; rerun against a stable artifact',
		);
	report.completed = true;
	save();
	console.log(
		`Wrote ${timings.length} timing rows and ${detection.length} corpus results to ${values.out}`,
	);
}

await main();
