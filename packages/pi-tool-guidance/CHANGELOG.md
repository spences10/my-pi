# @spences10/pi-tool-guidance

## 0.1.2

### Patch Changes

- d15e4b8: Ship extension changelogs, announce launcher updates,
  distinguish cost estimates, and display responding models alongside
  requests.

## 0.1.1

### Patch Changes

- a21d496: Add a `content` rule target that checks proposed write/edit
  text without changing existing whole-input rules. Allow corrective
  Svelte edits while retaining default `$effect` blocking, explain
  concrete alternatives and explicit policy exceptions, and
  distinguish opt-in warnings from blocks.

  Add language-aware validation guidance using native Codemode and
  verify guardrail parity for direct calls and both Codemode modes.
  Naming regexes remain user-configured; this does not migrate them to
  language-aware linting or make text matching syntax-aware.

## 0.1.0

### Minor Changes

- 720eb07: Restore timers, session autonaming, and portable tool
  guidance while preserving native Pi prompt configuration
  compatibility.
