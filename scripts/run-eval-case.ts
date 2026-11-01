#!/usr/bin/env node
/// <reference types="node" />
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface EvalOptions {
	run: string;
	suite: string;
	attempt: string;
	agent_dir: string;
	trusted: boolean;
}

function usage(): never {
	console.error(`Usage: node scripts/run-eval-case.ts --case <id> --prompt <text> [options] [-- extra my-pi args]

Options:
  --run <id>          Eval run id (default: local-<timestamp>)
  --suite <id>        Eval suite id (default: local)
  --attempt <n>       Attempt number (default: 1)
  --agent-dir <path>  Isolated Pi agent dir; telemetry is written to
                      <agent-dir>/telemetry.db (default: .tmp/pi-agent)
  --trusted           Trust project files (default: --no-approve)
`);
	process.exit(2);
}

const args = process.argv.slice(2);
const passthrough_index = args.indexOf('--');
const own_args =
	passthrough_index === -1 ? args : args.slice(0, passthrough_index);
const extra_args =
	passthrough_index === -1 ? [] : args.slice(passthrough_index + 1);

const options: EvalOptions = {
	run: `local-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`,
	suite: 'local',
	attempt: '1',
	agent_dir: '.tmp/pi-agent',
	trusted: false,
};
let case_id = '';
let prompt = '';

function next_value(index: number): string {
	const value = own_args[index + 1];
	if (!value) usage();
	return value;
}

for (let index = 0; index < own_args.length; index++) {
	const arg = own_args[index];
	if (arg === '--run') options.run = next_value(index++);
	else if (arg === '--suite') options.suite = next_value(index++);
	else if (arg === '--attempt') options.attempt = next_value(index++);
	else if (arg === '--agent-dir')
		options.agent_dir = next_value(index++);
	else if (arg === '--case') case_id = next_value(index++);
	else if (arg === '--prompt') prompt = next_value(index++);
	else if (arg === '--trusted') options.trusted = true;
	else usage();
}

if (!case_id || !prompt) usage();

const agent_dir = resolve(options.agent_dir);
const db_path = join(agent_dir, 'telemetry.db');
const my_pi_bin = resolve('packages/my-pi/dist/index.js');
mkdirSync(agent_dir, { recursive: true });
writeFileSync(
	join(agent_dir, 'my-pi-settings.json'),
	JSON.stringify({
		version: 1,
		packages: { telemetry: { version: 1, enabled: true } },
	}),
);

console.error(
	JSON.stringify(
		{
			run: options.run,
			case: case_id,
			suite: options.suite,
			attempt: options.attempt,
			telemetry_db: db_path,
			agent_dir: agent_dir,
		},
		null,
		2,
	),
);

const my_pi_args = [
	my_pi_bin,
	options.trusted ? '--approve' : '--no-approve',
	'--observability-disable',
	...extra_args,
	'--mode',
	'json',
	'-p',
	prompt,
];

const env = {
	...process.env,
	PI_CODING_AGENT_DIR: agent_dir,
	MY_PI_EVAL_RUN_ID: options.run,
	MY_PI_EVAL_CASE_ID: case_id,
	MY_PI_EVAL_ATTEMPT: options.attempt,
	MY_PI_EVAL_SUITE: options.suite,
};

const child = spawn(process.execPath, my_pi_args, {
	env,
	stdio: 'inherit',
});

child.on('exit', (code, signal) => {
	if (signal) {
		console.error(`my-pi exited via signal ${signal}`);
		process.exit(1);
	}
	console.error(
		`Telemetry: /telemetry export ./tmp/eval-runs.json run=${options.run} case=${case_id}`,
	);
	console.error(
		`Recall: pnpx pirecall recall "${case_id} ${options.suite}" --json`,
	);
	process.exit(code ?? 1);
});
