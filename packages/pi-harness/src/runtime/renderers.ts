import { build_path_helpers } from '../enforcement/policy.js';
import type { HarnessContract } from '../schema.js';
import { build_baseline_helpers } from './baseline.js';
import { shell_quote } from './files.js';

export function build_system_markdown(
	contract: HarnessContract,
): string {
	return `# Executor system prompt: ${contract.id}

You are working inside a my-pi task harness. The harness directory is external control state, not project source. System, developer, and current user instructions remain authoritative.

## Outer policy (accepted contract)

- Project cwd: \`${contract.policy.cwd}\`
- Forbidden edit paths: ${contract.policy.forbidden_paths.map((path) => `\`${path}\``).join(', ') || 'none'}
- Accepted maximum scope: ${(contract.policy.allowed_paths ?? []).map((path) => `\`${path}\``).join(', ') || 'legacy contract; recreate before execution'}
- Accepted checks: ${(contract.policy.validation_commands ?? []).map((command) => `\`${command}\``).join(', ') || 'none'}

The API and final drift guard preserve this scope and accepted checks. Shell commands retain the host user's permissions; these workflow checks are not OS isolation.

## Inner scaffold v${contract.scaffold.version} (amendable execution plan)

- Allowed edit paths: ${contract.scaffold.allowed_paths.map((path) => `\`${path}\``).join(', ') || 'none'}
- Test changes allowed: ${contract.scaffold.allow_test_changes ? 'yes' : 'no'}
- Validation: ${contract.scaffold.validation_commands.map((command) => `\`${command}\``).join(', ') || 'none'}

## Rules

1. Recover context from source-of-truth files before editing.
2. Challenge assumptions and record decisions through \`harness_update\`.
3. Treat the scaffold as subordinate to later user instructions. Use \`harness_amend\` when legitimate scope or strategy changes; a harness block is not a platform-policy refusal.
4. Edit only allowed paths.
5. Do not weaken tests, fake outputs, or bypass validation.
6. Run \`validate.sh\` before completion.
7. Ask for new authority rather than expanding accepted scope. Retry ordinary failures without a fixed attempt limit.
`;
}

export function build_task_markdown(
	contract: HarnessContract,
): string {
	return `# Harness task: ${contract.id}

## Task

${contract.scaffold.task}

## Required loop

1. Approved-contract recovery
2. Source-of-truth confirmation
3. Assumption-drift check
4. Surgical execution
5. Validation evidence
6. Drift review
7. Delta/risk report

## Escalation rules

${contract.scaffold.escalation_rules.map((rule) => `- ${rule}`).join('\n')}
`;
}

function build_resolve_cwd_script(contract: HarnessContract): string {
	return `contract_cwd=${shell_quote(contract.policy.cwd)}
run_cwd="$(pwd)"
contract_common=$(git -C "$contract_cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
run_common=$(git -C "$run_cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
if [ -z "$contract_common" ] || [ "$run_common" != "$contract_common" ]; then
  candidate="\${HARNESS_CWD:-$contract_cwd}"
  candidate_common=$(git -C "$candidate" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
  if [ -n "$contract_common" ] && [ "$candidate_common" = "$contract_common" ]; then
    run_cwd="$candidate"
  else
    run_cwd="$contract_cwd"
  fi
fi
export HARNESS_CWD="$run_cwd"`;
}

export function build_validate_script(
	contract: HarnessContract,
): string {
	const commands = [
		...new Set([
			...(contract.policy.validation_commands ?? []),
			...contract.scaffold.validation_commands,
		]),
	];
	return `#!/usr/bin/env bash
set -euo pipefail
${build_resolve_cwd_script(contract)}
cd "$HARNESS_CWD"
${commands
	.map(
		(
			command,
			index,
		) => `echo "[${index + 1}/${commands.length}] ${command.replaceAll('"', '\\"')}"
bash -lc ${shell_quote(command)}`,
	)
	.join('\n')}
`;
}

export function build_guard_script(): string {
	return `import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { isAbsolute, matchesGlob, relative, resolve } from 'node:path';

const contract = JSON.parse(readFileSync(new URL('./harness.json', import.meta.url), 'utf8'));

function resolve_cwd() {
  const contract_cwd = resolve(contract.policy.cwd);
  const candidate = process.env.HARNESS_CWD ? resolve(process.env.HARNESS_CWD) : contract_cwd;
  try {
    const common = (cwd) => execFileSync('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
    return common(candidate) === common(contract_cwd) ? candidate : contract_cwd;
  } catch {
    return contract_cwd;
  }
}

const cwd = resolve_cwd();
${build_baseline_helpers()}

${build_path_helpers()}

function is_test_path(relative_path) {
  return /(^|\\/)(__tests__|tests?)\\//.test(relative_path) || /\\.(test|spec)\\.[cm]?[jt]sx?$/.test(relative_path);
}

const violations = [];
for (const path of collect_task_changed_files(cwd, contract.policy)) {
  const absolute_path = resolve(cwd, path);
  if (absolute_path !== cwd && !absolute_path.startsWith(cwd + '/')) violations.push(path + ' is outside cwd');
  if (contract.policy.forbidden_paths.some((pattern) => pattern_matches(pattern, path))) violations.push(path + ' matches forbidden_paths');
  if ((!contract.scaffold.allow_test_changes || contract.policy.allow_test_changes === false) && is_test_path(path)) violations.push(path + ' is a test change but allow_test_changes is false');
  if (!contract.scaffold.allowed_paths.some((pattern) => pattern_matches(pattern, path)) || !(contract.policy.allowed_paths ?? contract.scaffold.allowed_paths).some((pattern) => pattern_matches(pattern, path))) violations.push(path + ' is outside allowed_paths');
}

if (violations.length) {
  console.error('Harness guard failed:');
  for (const violation of violations) console.error('- ' + violation);
  process.exit(1);
}
console.log('Harness guard passed');
`;
}

export function build_outcome_script(): string {
	return `import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const harness_dir = dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(readFileSync(join(harness_dir, 'harness.json'), 'utf8'));
const status = JSON.parse(readFileSync(join(harness_dir, 'status.json'), 'utf8'));
function resolve_cwd() {
  const contract_cwd = resolve(contract.policy.cwd);
  const candidate = process.env.HARNESS_CWD ? resolve(process.env.HARNESS_CWD) : contract_cwd;
  try {
    const common = (cwd) => execFileSync('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
    return common(candidate) === common(contract_cwd) ? candidate : contract_cwd;
  } catch {
    return contract_cwd;
  }
}

const cwd = resolve_cwd();
${build_baseline_helpers()}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

const task_files = collect_task_changed_files(cwd, contract.policy);
const logged_files = status.log.flatMap((entry) => entry.changed_files ?? []);
const latest = (key) => [...status.log].reverse().find((entry) => entry[key] !== undefined)?.[key];
const outcome = {
  id: contract.id,
  status: status.status,
  phase: status.phase,
  task: contract.scaffold.task,
  cwd: contract.policy.cwd,
  execution_cwd: cwd,
  generated_at: new Date().toISOString(),
  changed_files: unique([...task_files, ...logged_files]).sort(),
  baseline_changed_files: contract.policy.baseline_changed_files || [],
  validation: {
    commands: [...new Set([...(contract.policy.validation_commands ?? []), ...contract.scaffold.validation_commands])],
    checks: status.log.flatMap((entry) => entry.checks ?? []),
    evidence: status.log
      .filter((entry) => entry.evidence)
      .map((entry) => ({ timestamp: entry.timestamp, phase: entry.phase, evidence: entry.evidence })),
  },
  team_status: latest('team_status') ?? 'not recorded',
  remaining_risks: latest('remaining_risks') ?? (status.status === 'failed' ? ['Harness marked failed; inspect status.json.'] : []),
  log: status.log,
};

const list = (values, empty) => values.length ? values.map((value) => '- ' + value).join('\\n') : '- ' + empty;
const evidence = outcome.validation.evidence.length
  ? outcome.validation.evidence.map((entry) => '- ' + entry.timestamp + (entry.phase ? ' (' + entry.phase + ')' : '') + ': ' + entry.evidence).join('\\n')
  : '- No validation evidence recorded';
const markdown = '# Harness outcome: ' + outcome.id + '\\n\\n'
  + '- Status: ' + outcome.status + (outcome.phase ? ' (' + outcome.phase + ')' : '') + '\\n'
  + '- Generated: ' + outcome.generated_at + '\\n'
  + '- Project cwd: ' + outcome.cwd + '\\n\\n'
  + '## Task\\n\\n' + outcome.task + '\\n\\n'
  + '## Changed files\\n\\n' + list(outcome.changed_files, 'No changed files detected') + '\\n\\n'
  + '## Baseline files\\n\\n' + list(outcome.baseline_changed_files, 'No dirty baseline files recorded') + '\\n\\n'
  + '## Executed checks\\n\\n' + list(outcome.validation.checks.map((check) => (check.passed ? 'PASS ' : 'FAIL ') + check.command + ' — ' + check.output_file), 'No executed checks recorded') + '\\n\\n'
  + '## Validation evidence\\n\\nCommands:\\n' + list(outcome.validation.commands, 'No validation commands configured') + '\\n\\nSelf-reported notes (not execution proof):\\n' + evidence + '\\n\\n'
  + '## Team status\\n\\n' + outcome.team_status + '\\n\\n'
  + '## Remaining risks\\n\\n' + list(outcome.remaining_risks, 'No remaining risks recorded') + '\\n';

writeFileSync(join(harness_dir, 'outcome.json'), JSON.stringify(outcome, null, 2) + '\\n');
writeFileSync(join(harness_dir, 'OUTCOME.md'), markdown);
console.log('Wrote ' + join(harness_dir, 'OUTCOME.md'));
`;
}

export function build_review_script(
	contract: HarnessContract,
	guard_path: string,
	outcome_script_path: string,
): string {
	return `#!/usr/bin/env bash
set -euo pipefail
${build_resolve_cwd_script(contract)}
cd "$HARNESS_CWD"
echo "## git status"
git --no-optional-locks status --short || true
echo
echo "## diff stat"
git --no-optional-locks diff --stat || true
echo
echo "## outcome"
node ${shell_quote(outcome_script_path)}
echo
echo "## harness guard"
node ${shell_quote(guard_path)}
echo
echo "## harness"
echo ${shell_quote(contract.id)}
`;
}
