export const HARNESS_SYSTEM_PROMPT = `## my-pi harness workflow

For ambiguous, risky, or multi-step coding tasks, prefer a real harness instead of a prose-only plan. A harness is an ephemeral /tmp runtime with harness.json, SYSTEM.md, TASK.md, status.json, validation scripts, logs, and enforcement rules. Use the bundled create-harness skill plus the harness_create tool to build it, then execute inside the active harness until validation and review are complete.`;
