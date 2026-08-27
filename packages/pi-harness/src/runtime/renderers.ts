import type { HarnessContract } from '../schema.js';
import { shell_quote } from './files.js';

export function build_system_markdown(
	contract: HarnessContract,
): string {
	return `# Executor system prompt: ${contract.id}

You are working inside a my-pi task harness. The harness directory is external control state, not project source. System, developer, and current user instructions remain authoritative.

## Outer policy (runtime-enforced)

- Project cwd: \`${contract.policy.cwd}\`
- Forbidden edit paths: ${contract.policy.forbidden_paths.map((path) => `\`${path}\``).join(', ') || 'none'}

The outer policy protects the workspace and verifier. It cannot be weakened by the executor or by \`harness_amend\`.

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
7. Escalate instead of silently expanding the outer policy.
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
	const commands = contract.scaffold.validation_commands.length
		? contract.scaffold.validation_commands
		: ['echo "No validation commands configured"'];
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
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

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
const baseline = new Set(contract.policy.baseline_changed_files || []);

function changed_paths() {
  const status = execFileSync('git', ['-C', cwd, 'status', '--short', '--untracked-files=all'], { encoding: 'utf8' })
    .split('\\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => line.slice(3).split(' -> ').pop());
  const diff = execFileSync('git', ['-C', cwd, 'diff', '--name-only'], { encoding: 'utf8' })
    .split('\\n')
    .filter(Boolean);
  return [...new Set([...status, ...diff])];
}

function escape_regex(value) {
  const special = new Set(['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\\\', '-']);
  return [...value].map((char) => special.has(char) ? '\\\\' + char : char).join('');
}

function pattern_to_relative(pattern) {
  const normalized_pattern = pattern.replaceAll('\\\\', '/');
  if (!isAbsolute(pattern)) return normalized_pattern;
  return relative(cwd, resolve(pattern)).replaceAll('\\\\', '/');
}

function pattern_matches(pattern, relative_path) {
  const normalized_pattern = pattern_to_relative(pattern);
  if (normalized_pattern === '.') return true;
  if (normalized_pattern.endsWith('/**')) {
    const prefix = normalized_pattern.slice(0, -3);
    return relative_path === prefix || relative_path.startsWith(prefix + '/');
  }
  if (normalized_pattern.includes('*')) {
    const regex = new RegExp('^' + escape_regex(normalized_pattern).replaceAll('\\\\*\\\\*', '.*').replaceAll('\\\\*', '[^/]*') + '$');
    return regex.test(relative_path);
  }
  return relative_path === normalized_pattern || relative_path.startsWith(normalized_pattern + '/');
}

function is_test_path(relative_path) {
  return /(^|\\/)(__tests__|tests?)\\//.test(relative_path) || /\\.(test|spec)\\.[cm]?[jt]sx?$/.test(relative_path);
}

const violations = [];
for (const path of changed_paths()) {
  if (baseline.has(path)) continue;
  const absolute_path = resolve(cwd, path);
  if (absolute_path !== cwd && !absolute_path.startsWith(cwd + '/')) violations.push(path + ' is outside cwd');
  if (contract.policy.forbidden_paths.some((pattern) => pattern_matches(pattern, path))) violations.push(path + ' matches forbidden_paths');
  if (!contract.scaffold.allow_test_changes && is_test_path(path)) violations.push(path + ' is a test change but allow_test_changes is false');
  if (!contract.scaffold.allowed_paths.some((pattern) => pattern_matches(pattern, path))) violations.push(path + ' is outside allowed_paths');
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
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
const baseline = new Set(contract.policy.baseline_changed_files || []);

function git_lines(args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\\n')
      .map((line) => line.trimEnd())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

const status_files = git_lines(['status', '--short', '--untracked-files=all']).map((line) => line.slice(3).split(' -> ').pop()?.replace(/\\/$/, ''));
const diff_files = git_lines(['diff', '--name-only']);
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
  changed_files: unique([...status_files, ...diff_files, ...logged_files]).filter((file) => !baseline.has(file)).sort(),
  baseline_changed_files: contract.policy.baseline_changed_files || [],
  validation: {
    commands: contract.scaffold.validation_commands,
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
  + '## Validation evidence\\n\\nCommands:\\n' + list(outcome.validation.commands, 'No validation commands configured') + '\\n\\nEvidence:\\n' + evidence + '\\n\\n'
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
git status --short || true
echo
echo "## diff stat"
git diff --stat || true
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
