---
'@spences10/pi-coding-preferences': minor
'@spences10/pi-svelte-guardrails': patch
'@spences10/pi-tool-guidance': patch
'my-pi': patch
---

Add a `content` rule target that checks proposed write/edit text
without changing existing whole-input rules. Allow corrective Svelte
edits while retaining default `$effect` blocking, explain concrete
alternatives and explicit policy exceptions, and distinguish opt-in
warnings from blocks.

Add language-aware validation guidance using native Codemode and
verify guardrail parity for direct calls and both Codemode modes.
Naming regexes remain user-configured; this does not migrate them to
language-aware linting or make text matching syntax-aware.
