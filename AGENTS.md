# AGENTS.md

Guidance for coding agents working in this repository.

## Orientation

This repo holds reusable `@spences10/pi-*` Pi packages and the `my-pi`
command (`packages/my-pi`): upstream Pi with all of them built in and
switchable with `/extensions`. Prefer upstream Pi features over new
custom code.

Start with:

- `README.md` for usage and the package list.
- `docs/package-map.md` for installable vs support packages.
- `docs/dependency-overrides.md` before changing pnpm overrides.
- Package-local `README.md` files before changing package behavior or
  user-facing docs.

## Repository-specific skills

Project skills live under `.agents/skills/<skill>/SKILL.md`, which Pi
loads natively once the project is trusted. Load the matching skill
before doing the work:

| Task                                             | Skill                        |
| ------------------------------------------------ | ---------------------------- |
| Build or modify Pi extensions/packages           | `pi-extension-development`   |
| Compare proposed customisation with Pi built-ins | `pi-primitive-check`         |
| Prepare or validate releases                     | `pi-release-workflow`        |
| Run review-gated peer issue delivery             | `pi-review-gated-delivery`   |
| Develop or review the observability dashboard    | `pi-observability-local-dev` |
| Test published package installability            | `pi-package-sandbox-test`    |
| Validate repository edits                        | `pi-validation-flow`         |

Keep skill metadata activation-friendly:

- single-line `description`
- `# prettier-ignore` above long descriptions
- trigger language starts with `Use when...`
- validate with
  `pnpx check-skills validate .agents --recursive --json`

## Source of truth order

1. Package-local `README.md` files for user-facing package behavior.
2. `.agents/skills/*/SKILL.md` files for agent operating procedure.
3. Root `README.md` for repository commands.
4. Source/tests for implementation details when docs are incomplete.

## Commit and Changeset ownership

Do not commit changes or create a Changeset unless the user explicitly
requests that action. By default, stop after validation so the user
can review the implementation, then let the user create the Changeset
or request that it be created and committed.

Use a task harness when work benefits from an enforceable execution
contract because it has material risk, unresolved scope, destructive
effects, or complex coordination. Use the normal direct workflow for
bounded, low-risk work that standard validation can verify, including
routine docs, focused single-file fixes, config or metadata updates,
test expectation changes, formatting, and reviewed commit or push
follow-ups. Use Team Mode only for peer coordination already
authorized by the user.

## Validation

Follow `.agents/skills/pi-validation-flow/SKILL.md` for validation
commands. Validate the final changed state once before reporting
completion. Reuse passed checks for review, commit, and push if their
inputs are unchanged. Rerun only affected checks when inputs change,
or missing checks when prior results are unavailable. Keep Git hooks
and CI enabled.

Report changed files, validation run or reused, and unresolved risks
only.
