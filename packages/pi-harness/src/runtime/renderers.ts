import { shell_quote } from './files.js';
import type { HarnessContract } from '../schema.js';

export function build_system_markdown(
	contract: HarnessContract,
): string {
	return `# Executor system prompt: ${contract.id}

You are working inside a my-pi task harness. The harness directory is external control state, not the project source.

## Execution contract

- Project cwd: \`${contract.cwd}\`
- Allowed edit paths: ${contract.allowed_paths.map((path) => `\`${path}\``).join(', ') || 'none'}
- Forbidden edit paths: ${contract.forbidden_paths.map((path) => `\`${path}\``).join(', ') || 'none'}
- Test changes allowed: ${contract.allow_test_changes ? 'yes' : 'no'}
- Validation: ${contract.validation_commands.map((command) => `\`${command}\``).join(', ') || 'none'}

## Rules

1. Recover context from source-of-truth files before editing.
2. Challenge assumptions and record decisions in \`status.json\` through \`harness_update\`.
3. Edit only allowed paths.
4. Do not weaken tests, fake outputs, or bypass validation.
5. Run \`validate.sh\` before completion.
6. Escalate instead of silently expanding scope.
`;
}

export function build_task_markdown(
	contract: HarnessContract,
): string {
	return `# Harness task: ${contract.id}

## Task

${contract.task}

## Required loop

1. Context recovery
2. Source-of-truth capture
3. Assumption challenge
4. Alignment checkpoint
5. Surgical execution
6. Validation evidence
7. Drift review
8. Delta/risk report

## Escalation rules

${contract.escalation_rules.map((rule) => `- ${rule}`).join('\n')}
`;
}

function build_resolve_cwd_script(contract: HarnessContract): string {
	return `contract_cwd=${shell_quote(contract.cwd)}
run_cwd="\${HARNESS_CWD:-$(pwd)}"
if git -C "$run_cwd" rev-parse --git-common-dir >/dev/null 2>&1 && git -C "$contract_cwd" rev-parse --git-common-dir >/dev/null 2>&1; then
  run_common=$(git -C "$run_cwd" rev-parse --path-format=absolute --git-common-dir)
  contract_common=$(git -C "$contract_cwd" rev-parse --path-format=absolute --git-common-dir)
  if [ "$run_common" != "$contract_common" ]; then
    run_cwd="$contract_cwd"
  fi
else
  run_cwd="$contract_cwd"
fi
export HARNESS_CWD="$run_cwd"`;
}

export function build_validate_script(
	contract: HarnessContract,
): string {
	const commands = contract.validation_commands.length
		? contract.validation_commands
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
const cwd = resolve(process.env.HARNESS_CWD || contract.cwd);
const baseline = new Set(contract.baseline_changed_files || []);

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
  if (contract.forbidden_paths.some((pattern) => pattern_matches(pattern, path))) violations.push(path + ' matches forbidden_paths');
  if (!contract.allow_test_changes && is_test_path(path)) violations.push(path + ' is a test change but allow_test_changes is false');
  if (!contract.allowed_paths.some((pattern) => pattern_matches(pattern, path))) violations.push(path + ' is outside allowed_paths');
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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const harness_dir = dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(readFileSync(join(harness_dir, 'harness.json'), 'utf8'));
const status = JSON.parse(readFileSync(join(harness_dir, 'status.json'), 'utf8'));
const cwd = process.env.HARNESS_CWD || contract.cwd;
const baseline = new Set(contract.baseline_changed_files || []);

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
  task: contract.task,
  cwd: contract.cwd,
  execution_cwd: cwd,
  generated_at: new Date().toISOString(),
  changed_files: unique([...status_files, ...diff_files, ...logged_files]).filter((file) => !baseline.has(file)).sort(),
  baseline_changed_files: contract.baseline_changed_files || [],
  validation: {
    commands: contract.validation_commands,
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
