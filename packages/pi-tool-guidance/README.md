# @spences10/pi-tool-guidance

<!-- package-readme:header:start -->

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-tool-guidance?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-tool-guidance)
[![license](https://img.shields.io/npm/l/@spences10/pi-tool-guidance)](https://www.npmjs.com/package/@spences10/pi-tool-guidance)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

<!-- package-readme:header:end -->

## Tool workflow guidance

Distributes native Pi skills and concise system-prompt reminders for
nopeek, Omnisearch, SQLite, and language-aware validation. It does not
depend on the maintainer's local files.

## What ships

- `my-pi-nopeek`: one-shot credential loading, explicit key
  allowlists, separate-shell limitations, and output disclosure
  precautions.
- `my-pi-omnisearch`: tool discovery, source extraction, and verified
  research.
- `my-pi-sqlite`: schema inspection, bounded queries, backups,
  transactions, and respecting database safety gates.

Pi advertises these native skills and loads their full contents on
demand. Invoke `/skill:my-pi-nopeek`, `/skill:my-pi-omnisearch`, or
`/skill:my-pi-sqlite` to request one explicitly.

Essential reminders are contributed through a named structured prompt
section. Secret guidance is active with shell access; MCP guidance is
conditional on reachable tools or Pi's configured indirect-server
listing. Both codemode and tool-search exposure work without requiring
direct tool declarations.

## Language-aware validation

When editing and shell tools are reachable, the prompt reminds the
agent to use the project's configured linter, type checker, Svelte
tooling, and tests for code correctness. Coding-preference regexes
remain workflow/text policies; Svelte guardrails block `$effect` by
default, with explicit user-controlled exceptions. No parser,
classifier gate, new validation tool, or automatic command execution
is added.

Use native Codemode to coordinate existing tools:

1. Read project instructions and package scripts to select the
   affected checks; do not assume every project uses the same
   commands.
2. Apply edits through `tools.edit()` / `tools.write()` and await them
   before checking. Native nested calls retain the same guardrail
   hooks as direct calls; do not scan the outer JavaScript as source
   code.
3. Run independent checks together only when they do not share mutable
   outputs. Keep dependent edits, builds, and checks sequential.
4. Inspect exit codes and tool errors, then summarize diagnostics. Do
   not infer success from a fulfilled promise: `bash` resolves even
   when its command exits nonzero.
5. Correct the findings and rerun affected checks before reporting
   completion. Code validation runs after the edit; it is not an
   atomic pre-write security boundary.

For example, after choosing this repository's `check` script:

```js
const result = await tools.bash({
	command: 'pnpm run check',
	timeout: 120,
});
text({
	exit_code: result.exit_code,
	truncated: result.truncated,
	output: result.output.slice(-12000),
	full_output_path: result.full_output_path,
});
if (result.exit_code !== 0) throw new Error('Project checks failed');
```

Inspect omitted output before diagnosing a failure. For multiple
independent tool calls, `Promise.allSettled()` preserves successful
results when another call rejects; inspect each result as well as each
command's exit code. Codemode is orchestration, not a syntax checker
or a way around guardrails. No classifier or paid model call is
needed.

## User configuration remains yours

The package does not install the nopeek CLI, start MCP servers, set
provider credentials, or modify `SYSTEM.md`, `APPEND_SYSTEM.md`, or
`mcp.json`. Configure the required tools through Pi's normal
mechanisms. Native prompt files coexist with the package's section;
disabling this extension removes its bundled resources on reload in
my-pi.

Instructions are guidance, not a security boundary. Child processes
can still print secrets; redaction and database permission enforcement
remain separate. Third-party extensions that force a complete prompt
can hide later structured sections; prefer Pi's structured prompt API.

Bundled into my-pi as `tool-guidance`. Use
`/extensions disable tool-guidance` to remove its reminders and
bundled skills on reload. The package manifest exposes the same skills
in standalone Pi.

## Install

<!-- package-readme:install:start -->

```bash
pi install npm:@spences10/pi-tool-guidance
```

<!-- package-readme:install:end -->

## Development

<!-- package-readme:development:start commands="check,test,build" -->

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-tool-guidance run check
pnpm --filter @spences10/pi-tool-guidance run test
pnpm --filter @spences10/pi-tool-guidance run build
```

<!-- package-readme:development:end -->

## License

MIT
