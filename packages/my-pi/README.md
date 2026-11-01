# my-pi

Upstream [Pi](https://pi.dev) with these extensions loaded by default:

- [`@spences10/pi-redact`](https://github.com/spences10/my-pi/tree/main/packages/pi-redact#readme)
- [`@spences10/pi-confirm-destructive`](https://github.com/spences10/my-pi/tree/main/packages/pi-confirm-destructive#readme)
- [`@spences10/pi-context`](https://github.com/spences10/my-pi/tree/main/packages/pi-context#readme)
- [`@spences10/pi-lsp`](https://github.com/spences10/my-pi/tree/main/packages/pi-lsp#readme)

```bash
pnpx my-pi@latest
```

`my-pi` calls upstream Pi's `main()`, so all Pi options, commands,
settings, and resources work as documented upstream. Add other
packages with `pi install`. To run without the default extensions, run
`pi`.

Do not also `pi install` the four default packages: they would load
twice.
