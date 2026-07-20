# @spences10/pi-factory

<!-- package-readme:header:start -->

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-factory?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-factory)
[![license](https://img.shields.io/npm/l/@spences10/pi-factory)](https://www.npmjs.com/package/@spences10/pi-factory)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

<!-- package-readme:header:end -->

A governed workflow control plane for Pi. It routes complex software
work through one task contract, one harness, deterministic validation,
independent review, and explicit approval gates.

Use Factory for ambiguous or high-risk work, coordinated delivery, or
changes that need review gates. Routine changes in one coding session
do not need Factory solely because a commit or push was requested.

## Installation

<!-- package-readme:install:start -->

```bash
pi install npm:@spences10/pi-factory
```

<!-- package-readme:install:end -->

Local development from this monorepo:

```bash
pnpm --filter @spences10/pi-factory run build
pi install ./packages/pi-factory
# or for one run only
pi -e ./packages/pi-factory
```

## How it works

```text
preview → contract → execute → validate → review → approve → outcome
```

1. Preview a task to see the selected workflow, risk, compute policy,
   validation, review mode, and required approvals.
2. Start the task to create its durable workflow state and one
   authoritative `pi-harness`.
3. Factory progresses eligible planning, execution, and validation
   through an owned adapter or an explicit peer handoff.
4. Failed gates produce bounded feedback rather than redefining
   success.
5. Required side effects stop for human approval before the workflow
   records its outcome.

Factory includes workflows for chores, features, ambiguous bugs, UI
copy, database migrations, incidents, architecture, and safe releases.
Routing can strengthen a requested workflow when the affected surface
or safety signals require it.

## Commands

```text
/factory preview <task>
/factory start <task>
/factory status <workflow-id>
/factory resume <workflow-id>
/factory cancel <workflow-id>
/factory metrics
```

The bundled `factory` tool provides the full workflow API used by the
agent. Detailed operating instructions are supplied by the bundled
[`software-factory` skill](./skills/software-factory/SKILL.md), so
they do not need to be repeated here.

## What it provides

- explained, complexity-aware workflow routing
- a versioned task contract and one authoritative harness
- one mutating owner with explicit ownership transfer
- owned RPC execution or acknowledged peer handoff
- deterministic validation with bounded retries
- diff-bound independent review
- explicit approval gates for commit, push, deploy, release,
  destructive, and configured public-contract actions
- durable recovery, terminal outcomes, and correlated metrics
- optional repository policy, external intake, and calibration APIs

Workflow state is stored under Pi's agent directory, normally
`~/.pi/agent/factory`. Set `MY_PI_FACTORY_DIR` to use another
location.

## Safety boundary

Factory supervises only processes started through an owned execution
adapter. It does not spawn or control independently opened Pi
sessions, and mailbox delivery is not evidence that a peer completed
work.

Process settlement is not task success. Completion requires evidence
bound to the current contract, validation, review, and approval state.
Factory never infers human approval from validation, silence,
delivery, or model output.

See the [v1 architecture boundary](./ARCHITECTURE.md) for the detailed
responsibility map, compatibility guarantees, and unsupported claims.

## Using from a custom runtime

```ts
import factory from '@spences10/pi-factory';

// pass `factory` as an ExtensionFactory to your Pi runtime
```

The package also exports its dispatcher, state engine, execution
adapters, policy, review, metrics, intake, and calibration APIs for
programmatic integrations.

## Development

```bash
pnpm --filter @spences10/pi-factory run check:self
pnpm --filter @spences10/pi-factory run test:self
pnpm --filter @spences10/pi-factory run build
```

## License

MIT
