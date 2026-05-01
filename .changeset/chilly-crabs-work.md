---
'@spences10/pi-team-mode': patch
---

Harden teammate worktree assignment by refusing active duplicate path
or branch assignments and validating git worktree path and branch
reuse before spawning.
