# @spences10/pi-workers

## 0.3.1

### Patch Changes

- Updated dependencies [ca94e4d]
  - @spences10/pi-team-mode@0.3.1

## 0.3.0

### Minor Changes

- 0294e26: Require explicit collaboration, persist notification
  controls, route workers correctly; breaking change: unsolicited
  messages stay quiet.

### Patch Changes

- Updated dependencies [0294e26]
  - @spences10/pi-team-mode@0.3.0

## 0.2.0

### Minor Changes

- a87c68d: Add compact team messages and worker reports with
  expandable details while preserving existing coordination behavior.
- 24f88d6: Add local RPC workers with approval forwarding, lifecycle
  controls, Team Mode messaging, and observability integration.
- 905e95a: Add shared modal worker management with inspectable
  results, stable targeting, messaging, refresh, and confirmed
  stopping.

### Patch Changes

- 75b417e: Refactor nested ternaries into explicit branches across
  packages, preserving existing behavior and improving code
  readability.
- 5f29993: Fix worker name reuse, redact diagnostics safely, and
  strengthen process cleanup with focused regression coverage.
- Updated dependencies [75b417e]
- Updated dependencies [d15e4b8]
  - @spences10/pi-tui-modal@0.0.25
  - @spences10/pi-redact@0.0.16

## 0.1.0

Initial local RPC worker implementation.
