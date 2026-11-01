import {
	createAgentSession,
	createCodemodeExtension,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type ExtensionAPI,
} from '@earendil-works/pi-coding-agent';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Type } from 'typebox';
import { register_context_lifecycle } from '../lifecycle.js';
import {
	get_context_store,
	set_context_sidecar_enabled,
} from '../store.js';
import { register_context_tools } from '../tools/index.js';

type Variant = 'baseline' | 'codemode-first' | 'native-only';
type Scenario =
	| 'bash-filter'
	| 'read-filter'
	| 'mcp-filter'
	| 'final-overflow'
	| 'small-output';

export interface CodemodeBenchmarkResult {
	variant: Variant;
	scenario: Scenario;
	correct: boolean;
	model_facing_bytes: number;
	top_level_calls: number;
	nested_calls: number;
	retrieval_calls: number;
	stored_sources: number;
	stored_bytes: number;
	tool_declaration_bytes: number;
	wall_ms: number;
}

const scenarios: Scenario[] = [
	'bash-filter',
	'read-filter',
	'mcp-filter',
	'final-overflow',
	'small-output',
];
const metrics = (count: number) =>
	Array.from({ length: count }, (_, i) => `metric=${i + 1}`).join(
		'\n',
	) + '\n';
const summarize = `const values = [...raw.matchAll(/^metric=(\\d+)/gm)].map(m => Number(m[1])); text({ count: values.length, sum: values.reduce((a, b) => a + b, 0) });`;

async function run_case(
	variant: Variant,
	scenario: Scenario,
	baseline_dir: string,
): Promise<CodemodeBenchmarkResult> {
	const dir = mkdtempSync(
		join(tmpdir(), 'pi-context-codemode-bench-'),
	);
	const previous_db = process.env.MY_PI_CONTEXT_DB;
	const previous_config = process.env.MY_PI_CONTEXT_CONFIG;
	const previous_retention = process.env.MY_PI_CONTEXT_RETENTION_DAYS;
	const previous_capture_kb =
		process.env.MY_PI_CONTEXT_CAPTURE_MAX_KB;
	const previous_capture_lines =
		process.env.MY_PI_CONTEXT_CAPTURE_MAX_LINES;
	const previous_max_mb = process.env.MY_PI_CONTEXT_MAX_MB;
	const previous_shutdown =
		process.env.MY_PI_CONTEXT_PURGE_ON_SHUTDOWN;
	process.env.MY_PI_CONTEXT_DB = join(dir, 'context.db');
	process.env.MY_PI_CONTEXT_CONFIG = join(dir, 'context.json');
	process.env.MY_PI_CONTEXT_RETENTION_DAYS = 'off';
	process.env.MY_PI_CONTEXT_CAPTURE_MAX_KB = '24';
	process.env.MY_PI_CONTEXT_CAPTURE_MAX_LINES = '300';
	process.env.MY_PI_CONTEXT_MAX_MB = 'off';
	process.env.MY_PI_CONTEXT_PURGE_ON_SHUTDOWN = 'false';
	writeFileSync(
		join(dir, 'context.json'),
		JSON.stringify({
			version: 1,
			preset: 'custom',
			retention_days: null,
			max_mb: null,
			capture_max_bytes: 24 * 1024,
			capture_max_lines: 300,
			purge_on_shutdown: false,
		}),
	);
	writeFileSync(join(dir, 'metrics.txt'), metrics(400));

	const sidecar =
		variant === 'baseline'
			? {
					...(await import(
						pathToFileURL(join(baseline_dir, 'lifecycle.js')).href
					)),
					...(await import(
						pathToFileURL(join(baseline_dir, 'tools/index.js')).href
					)),
					...(await import(
						pathToFileURL(join(baseline_dir, 'store.js')).href
					)),
				}
			: {
					register_context_lifecycle,
					register_context_tools,
					get_context_store,
					set_context_sidecar_enabled,
				};
	let nested_calls = 0;
	let retrieval_calls = 0;
	const mcp_text = metrics(1000);
	const extension = (pi: ExtensionAPI) => {
		if (variant !== 'native-only') {
			sidecar.register_context_lifecycle(pi);
			sidecar.register_context_tools(pi);
		}
		// Deterministic MCP-shaped result; no external server, credentials, or network.
		pi.registerTool({
			name: 'mcp__fixture__metrics',
			label: 'Fixture metrics',
			description: 'Synthetic benchmark metrics',
			parameters: Type.Object({}),
			outputSchema: Type.Object({
				content: Type.Array(
					Type.Object({
						type: Type.Literal('text'),
						text: Type.String(),
					}),
				),
			}),
			async execute() {
				return {
					content: [{ type: 'text', text: mcp_text }],
					details: {},
					structuredContent: {
						content: [{ type: 'text', text: mcp_text }],
					},
				};
			},
		});
		pi.on('tool_result', async (event) => {
			if (event.parentToolCallId) nested_calls++;
			if (event.toolName.startsWith('context_')) retrieval_calls++;
		});
	};
	const settingsManager = SettingsManager.inMemory({
		defaultTools: ['read', 'bash', 'codemode'],
	});
	const loader = new DefaultResourceLoader({
		cwd: dir,
		agentDir: dir,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noThemes: true,
		noPromptTemplates: true,
		agentsFilesOverride: () => ({ agentsFiles: [] }),
		extensionFactories: [createCodemodeExtension(), extension],
	});
	await loader.reload();
	const modelRuntime = await ModelRuntime.create({
		authPath: join(dir, 'auth.json'),
		modelsPath: null,
		modelsStorePath: join(dir, 'models-cache.json'),
		refreshOnCreate: false,
	});
	const { session } = await createAgentSession({
		cwd: dir,
		agentDir: dir,
		resourceLoader: loader,
		modelRuntime,
		settingsManager,
		sessionManager: SessionManager.inMemory(dir),
	});
	try {
		await session.bindExtensions({});
		// A scripted assistant fixture enables the real nested-call pipeline without an LLM request.
		session.agent.state.messages.push({
			role: 'assistant',
			content: [],
			api: 'anthropic-messages',
			provider: 'fixture',
			model: 'fixture',
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					total: 0,
				},
			},
			stopReason: 'stop',
			timestamp: Date.now(),
		});
		const codemode = session.agent.state.tools.find(
			(tool) => tool.name === 'codemode',
		)!;
		const tool_declaration_bytes = Buffer.byteLength(
			JSON.stringify(
				session.agent.state.tools.map(
					({ name, description, parameters }) => ({
						name,
						description,
						parameters,
					}),
				),
			),
		);
		let top_level_calls = 0;
		let model_facing_bytes = 0;
		const run = async (code: string) => {
			const id = `bench-${++top_level_calls}`;
			const result = await codemode.execute(id, { code });
			const replacement =
				await session.extensionRunner.emitToolResult({
					type: 'tool_result',
					toolName: 'codemode',
					toolCallId: id,
					input: { code },
					content: result.content,
					details: result.details,
					structuredContent: result.structuredContent,
					isError: false,
				});
			const content = replacement?.content ?? result.content;
			const text = content
				.filter((item) => item.type === 'text')
				.map((item) => item.text)
				.join('\n');
			model_facing_bytes += Buffer.byteLength(text);
			if (text.includes('Script failed')) throw new Error(text);
			return text;
		};
		const started = performance.now();
		let code: string;
		if (scenario === 'small-output')
			code = 'text({ count: 1, sum: 1 });';
		else if (scenario === 'final-overflow')
			code = `text(${JSON.stringify('overflow-marker\n' + 'diagnostic detail\n'.repeat(800))});`;
		else {
			const call =
				scenario === 'bash-filter'
					? `await tools.bash({ command: "printf 'metric=%s\\n' {1..400}" })`
					: scenario === 'read-filter'
						? 'await tools.read({ path: "metrics.txt" })'
						: 'await tools.mcp__fixture__metrics({})';
			const extract =
				scenario === 'bash-filter'
					? 'r.output'
					: scenario === 'read-filter'
						? 'r'
						: 'r.content.map(c => c.text).join("\\n")';
			code = `const r = ${call}; if (typeof r === 'string' && r.includes('[context-sidecar]')) { text(r); exit(); } const raw = ${extract}; ${summarize}`;
		}
		let output = await run(code);
		const receipt_source = /Source: (ctx_\w+)/.exec(output)?.[1];
		if (receipt_source) {
			if (scenario === 'final-overflow') {
				output = await run(
					`const r = await tools.context_search({ source_id: ${JSON.stringify(receipt_source)}, query: 'overflow-marker' }); text({ found: JSON.stringify(r).includes('overflow-marker') });`,
				);
			} else {
				output = await run(
					`const r = await tools.context_get({ source_id: ${JSON.stringify(receipt_source)} }); const raw = typeof r === 'string' ? r : r.chunks.map(c => c.content).join(''); ${summarize}`,
				);
			}
		}
		const correct =
			scenario === 'final-overflow'
				? output.includes(
						receipt_source ? '"found":true' : 'overflow-marker',
					)
				: scenario === 'small-output'
					? output.includes('"count":1,"sum":1')
					: output.includes(
							scenario === 'mcp-filter'
								? '"count":1000,"sum":500500'
								: '"count":400,"sum":80200',
						);
		const stats =
			variant === 'native-only'
				? undefined
				: sidecar.get_context_store().stats();
		return {
			variant,
			scenario,
			correct,
			model_facing_bytes,
			top_level_calls,
			nested_calls,
			retrieval_calls,
			stored_sources: stats?.sources ?? 0,
			stored_bytes: stats?.bytes_stored ?? 0,
			tool_declaration_bytes,
			wall_ms: Math.round((performance.now() - started) * 100) / 100,
		};
	} finally {
		const store =
			variant === 'native-only'
				? undefined
				: sidecar.get_context_store();
		await session.extensionRunner.emit({
			type: 'session_shutdown',
			reason: 'quit',
		});
		session.dispose();
		store?.close();
		for (const [key, value] of Object.entries({
			MY_PI_CONTEXT_DB: previous_db,
			MY_PI_CONTEXT_CONFIG: previous_config,
			MY_PI_CONTEXT_RETENTION_DAYS: previous_retention,
			MY_PI_CONTEXT_CAPTURE_MAX_KB: previous_capture_kb,
			MY_PI_CONTEXT_CAPTURE_MAX_LINES: previous_capture_lines,
			MY_PI_CONTEXT_MAX_MB: previous_max_mb,
			MY_PI_CONTEXT_PURGE_ON_SHUTDOWN: previous_shutdown,
		})) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		rmSync(dir, { recursive: true, force: true });
	}
}

export async function run_codemode_benchmark(
	baseline_dir?: string,
	runs = 3,
) {
	if (!Number.isInteger(runs) || runs < 1 || runs > 20)
		throw new Error('runs must be an integer from 1 to 20');
	const results: Array<CodemodeBenchmarkResult & { run: number }> =
		[];
	const variants: Variant[] = baseline_dir
		? ['baseline', 'codemode-first', 'native-only']
		: ['codemode-first', 'native-only'];
	for (let run = 1; run <= runs; run++) {
		for (const variant of variants) {
			for (const scenario of scenarios)
				results.push({
					...(await run_case(variant, scenario, baseline_dir ?? '')),
					run,
				});
		}
	}
	return {
		version: 1,
		runs,
		runtime: process.version,
		measurement:
			'Deterministic native codemode execution; UTF-8 output bytes, not API token usage or billed cost.',
		results,
	};
}

if (
	process.argv[1] &&
	fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
	const baseline = process.argv.includes('--baseline')
		? process.argv[process.argv.indexOf('--baseline') + 1]
		: undefined;
	if (process.argv.includes('--baseline') && !baseline)
		throw new Error('--baseline requires a dist directory');
	const runs = process.argv.includes('--runs')
		? Number(process.argv[process.argv.indexOf('--runs') + 1])
		: 3;
	const report = await run_codemode_benchmark(
		baseline ? resolve(baseline) : undefined,
		runs,
	);
	const output = process.argv[process.argv.indexOf('--output') + 1];
	if (process.argv.includes('--output') && output)
		writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
	console.log(JSON.stringify(report, null, 2));
	if (report.results.some((result) => !result.correct))
		process.exitCode = 1;
}
