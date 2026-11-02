# @spences10/pi-coding-preferences

<!-- package-readme:header:start -->

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-coding-preferences?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-coding-preferences)
[![license](https://img.shields.io/npm/l/@spences10/pi-coding-preferences)](https://www.npmjs.com/package/@spences10/pi-coding-preferences)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

<!-- package-readme:header:end -->

Keep agents aligned with your local workflow before bad commands run.
`pi-coding-preferences` turns workflow preferences—like using `rg`
instead of `grep`—into lightweight guardrails that nudge the model
toward the project’s conventions.

It ships with default workflow preferences. Configure user rules in
`codingPreferences.rules` in `~/.pi/agent/my-pi-settings.json` and
project rules in `.pi/coding-preferences.json`. When either supplies
configuration, configured rules are loaded instead of the built-in
defaults. The example below is a project configuration.

```json
{
	"rules": [
		{
			"name": "no-npm",
			"toolNames": ["bash"],
			"target": "command",
			"pattern": "^npm\\b",
			"reason": "Use pnpm in this repo."
		}
	]
}
```

Rule targets are:

- `command`: the shell command.
- `path`: the tool's file path.
- `input` (default): every string in the tool input, including edit
  `oldText` and `newText`. Existing rules keep this behavior.
- `content`: only `write.content`, single-edit `newText`, and every
  batched `edits[].newText`. Paths, old text, commands, and unrelated
  fields are excluded, so removing a violation is allowed.

Patterns are JavaScript regular expressions. A blocked call reports
the rule name and nested input field, but not the matched value.
`content` is still text matching, not syntax-aware validation.

Use these rules for workflow restrictions or explicit text policies.
For naming conventions, remove custom declaration-matching regexes
such as `prefer-project-snake-case-identifiers` and use the project's
language-aware linter instead. Changing that rule to `content` alone
does not fix prose false positives. User configuration is not
rewritten automatically.

Direct tool calls and native Codemode's `tools.edit()` /
`tools.write()` pass through the same guardrail hooks. Codemode
coordinates tools; it does not replace enforcement or language-aware
checks. See the
[validation workflow](https://github.com/spences10/my-pi/tree/main/packages/pi-tool-guidance#language-aware-validation).

<!-- package-readme:install:start -->

```bash
pi install npm:@spences10/pi-coding-preferences
```

<!-- package-readme:install:end -->

This is opt-in: installing the package globally applies it to your Pi
sessions, but projects and downstream users do not inherit it unless
they install the package.

## Development

<!-- package-readme:development:start commands="check,test,build" -->

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-coding-preferences run check
pnpm --filter @spences10/pi-coding-preferences run test
pnpm --filter @spences10/pi-coding-preferences run build
```

<!-- package-readme:development:end -->
