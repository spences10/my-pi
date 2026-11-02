# @spences10/pi-coding-preferences

<!-- package-readme:header:start -->

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-coding-preferences?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-coding-preferences)
[![license](https://img.shields.io/npm/l/@spences10/pi-coding-preferences)](https://www.npmjs.com/package/@spences10/pi-coding-preferences)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

<!-- package-readme:header:end -->

Keep agents aligned with your workflow and naming preferences before
commands run or files are written. Workflow rules use text patterns;
automatic naming checks use bundled TypeScript and Svelte parsers. No
project lint configuration or parser installation is required.

It ships with default workflow preferences. Configure user rules in
`codingPreferences.rules` in `~/.pi/agent/my-pi-settings.json` and
project rules in `.pi/coding-preferences.json`. When either supplies a
`rules` array, configured rules are loaded instead of the built-in
defaults. Naming-only configuration preserves the default workflow
rules. The example below is a project configuration.

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
For naming conventions, use the syntax-aware policy below and remove
custom declaration-matching regexes such as
`prefer-project-snake-case-identifiers`. Those old rules still run
independently and can match prose; switching their target to `content`
does not fix that. User configuration is not rewritten automatically.

## Automatic naming policy

Naming checks apply by default whenever this extension is loaded.
Configure them globally under `codingPreferences.naming` in
`~/.pi/agent/my-pi-settings.json`:

```json
{
	"codingPreferences": {
		"naming": {
			"variables": "snake_case",
			"functions": "snake_case",
			"types": "PascalCase"
		}
	}
}
```

These are the defaults. Each category accepts `snake_case`,
`camelCase`, `PascalCase`, or `false` to disable that category. Set
`"naming": false` to disable all naming checks. Leading/trailing `_`
and `$` markers are allowed. Existing `rules` entries are independent
of naming preferences.

An optional project `.pi/coding-preferences.json` can set `naming`
using the same shape (without the `codingPreferences` wrapper).
Project categories override global categories; omitted categories
inherit. Project `false` disables naming, while an explicit project
object re-enables it after a global `false`. No project file is needed
for global preferences to apply, including in a new project.

Coverage:

- JavaScript/TypeScript: `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`,
  `.mts`, `.cts`, including `.svelte.js` and `.svelte.ts` modules.
- Svelte components: JavaScript/TypeScript in instance and module
  script blocks. Template bindings and style blocks are not checked.
- Variables include parameters, catch bindings, and array/destructured
  local bindings. Function declarations/expressions and bindings
  initialized with an arrow/function use the `functions` category.
  Classes, interfaces, type aliases, enums, and class-expression
  bindings use `types`.
- Imports, object/class/interface member names, enum members,
  constructor parameter properties, and shorthand object bindings are
  left alone to preserve API names. Aliased destructuring checks the
  local binding. Comments, strings, and identifier references are not
  declaration checks.

The extension reuses Pi's native `write` and `edit` tools with checked
file operations. Pi resolves edits and supplies the complete proposed
file; parsing and naming validation happen before the file write.
Rejected calls report the file, location, name, expected style, and
rule. Retry with a corrected change; the rejected file stays
unchanged.

Unchanged legacy violations are tolerated by comparing counts of each
name/category against the original file. Fixing or removing violations
is allowed; introducing another violation is blocked. Invalid proposed
syntax is rejected because naming cannot be reliably checked. Invalid
original files can still be repaired. These are syntax/naming checks,
not type checks or a replacement for project linting and tests.

This covers direct and Codemode-mediated calls to these native tools,
not arbitrary shell writes or other file-writing tools. Another
extension replacing `write`/`edit` can conflict with these overrides;
compose its file operations explicitly rather than assuming coverage.

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
