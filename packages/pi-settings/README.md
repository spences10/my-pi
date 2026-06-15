# @spences10/pi-settings

Shared settings store for `my-pi` and related `@spences10/pi-*`
packages.

This package is published so other published packages can depend on
the same settings helpers at install time. It is support
infrastructure, not a Pi extension package users normally install
directly with `pi install`.

## API

- `get_settings_path()` returns the canonical `my-pi-settings.json`
  path.
- `read_settings()` and `write_settings()` read and write the full
  settings file.
- `read_settings_section()` reads a top-level settings section with a
  fallback.
- `read_package_settings()` and `write_package_settings()` manage
  package-specific settings.
- `read_trust_settings()` and `write_trust_settings()` manage trust
  settings.
