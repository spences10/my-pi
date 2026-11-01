---
name: pi-primitive-check
# prettier-ignore
description: Use when evaluating proposed Pi customisation work against built-in Pi primitives before implementation, especially extensions, packages, slash commands, and workflow ideas.
compatibility:
  Requires the Pi coding-agent monorepo docs and source tree.
---

# Pi Primitive Check

Use this before implementing speculative Pi customisation ideas. The
goal is to avoid building a parallel abstraction when Pi already has a
primitive.

## Workflow

1. Restate the underlying user need, separate from the proposed
   solution.
2. Search local Pi docs for overlapping primitives, especially
   commands, session features, SDK APIs, extension events, tools,
   skills, and TUI APIs.
3. Search this repo for existing built-ins and `packages/pi-*` that
   already address the need.
4. Classify the proposal:
   - use existing Pi primitive
   - document or wrap existing primitive
   - compose existing primitives
   - implement new feature
5. If overlap exists, pause and ask the user to confirm before coding.

## Required local sources

Resolve the installed package from the repository root instead of
hard-coding pnpm's versioned store path:

```bash
UPSTREAM_PI_ROOT="$(realpath node_modules/@earendil-works/pi-coding-agent)"
```

Read relevant files under `$UPSTREAM_PI_ROOT` before deciding:

- `README.md` for package-level behavior
- `docs/` for documented primitives and APIs
- `examples/` for supported implementation patterns

If the dependency is not installed, run the repository's normal
install workflow rather than substituting stale online documentation.
Prefer targeted `rg` over broad reading, then read the relevant docs
fully enough to verify behavior.

## Output format

```md
Primitive check:

- User need:
- Existing Pi primitives:
- Existing Pi customisation pieces:
- Overlap/risk:
- Recommendation:
- Confirm before build:
```

Keep the recommendation direct. If the answer is “do not build this”,
say so.
