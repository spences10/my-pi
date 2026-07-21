# @spences10/pi-settings

Shared settings store for `my-pi` and related `@spences10/pi-*`
packages.

This package is published so other published packages can depend on
the same settings helpers at install time. It is support
infrastructure, not a Pi extension package users normally install
directly with `pi install`.

## Relationship to upstream Pi

Audit baseline: upstream Pi
[`0.80.10`](https://github.com/earendil-works/pi/tree/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent)
owns `~/.pi/agent/settings.json`, trusted project overrides in
`.pi/settings.json`, package/resource selection through `pi config`,
and project deltas using `autoload: false`. Use those native settings
for packages, extensions, skills, prompts, and themes.

This package intentionally keeps `my-pi-settings.json` as a separate,
global store for namespaced extension state such as MCP policy,
profiles, UI preferences, and resource-specific trust records. Those
values are outside Pi's `SettingsManager` schema and must not be read
from repo-controlled `.pi/settings.json`. The store delegates agent
directory resolution to Pi's `getAgentDir()`; it does not duplicate
Pi's global/project resource merge behavior.

## API

- `get_settings_path()` returns the canonical global
  `my-pi-settings.json` path. It never resolves to
  `.pi/settings.json`.
- `read_settings()` and `write_settings()` read and write the full
  settings file.
- `read_settings_section()` reads a top-level settings section with a
  fallback.
- `read_package_settings()` and `write_package_settings()` manage
  package-specific settings.
- `read_trust_settings()` and `write_trust_settings()` manage trust
  settings.
