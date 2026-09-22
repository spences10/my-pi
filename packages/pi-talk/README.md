# @spences10/pi-talk

<!-- package-readme:header:start -->

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-talk?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-talk)
[![license](https://img.shields.io/npm/l/@spences10/pi-talk)](https://www.npmjs.com/package/@spences10/pi-talk)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

<!-- package-readme:header:end -->

Opt-in hold-to-talk dictation for **my-pi** and Pi. Hold Space to
record, then release it to transcribe into the active editor. A quick
Space tap remains a normal space.

Talk is off by default. It does not intercept Space until you enable
it through `/talk setup` or `/talk on`.

## Requirements

- Linux with PipeWire's `pw-record`
- Node.js 24.15 or newer
- Deepgram API key
- Pi 0.85.0 or newer

## Installation

<!-- package-readme:install:start -->

```bash
pi install npm:@spences10/pi-talk
```

<!-- package-readme:install:end -->

Set up Talk inside Pi:

```text
/talk setup
```

The setup flow explains where the key is stored, then opens a masked
input. After setup, hold Space to dictate and release it to
transcribe. The transcript stays in the editor for review and is never
submitted automatically.

## Commands

```text
/talk setup   Store a Deepgram key and enable Talk
/talk on      Enable Talk with the stored or environment key
/talk off     Disable Talk without deleting the stored key
/talk forget  Disable Talk and delete the stored key
/talk status  Show state, key source, and the next action
```

Talk has three user-visible states:

- `not configured`: no stored or environment key; Space is untouched
- `off`: a key is available, but Space is untouched
- `ready`: hold-Space detection is active

## Secret storage

`/talk setup` stores the key under `packages.pi-talk` in
`~/.pi/agent/my-pi-secrets.json`, or in the configured Pi agent
directory. The file uses private permissions (`0600`). Writes preserve
secrets owned by other packages.

The masked setup input does not add the key to the conversation or Pi
session history. Talk notifications and errors never include the key.

You can use `DEEPGRAM_API_KEY` or `DEEPGRAM` instead of storing a key.
An environment key does not enable Talk automatically; run `/talk on`.

## Runtime behavior

- A normal Space tap passes through immediately, including when the
  next key is pressed before Space is released.
- Other typing, cursor movement, or pasted input cancels a pending
  hold. Fast typing never restores an earlier copy of the editor.
- Spaces inserted before a hold is recognized stay in the editor;
  further repeats are consumed while recording.
- A held Space starts mono 16-bit, 16 kHz capture through `pw-record`.
- Audio streams to Deepgram's live `nova-3` API.
- Releasing Space finalizes the stream and inserts final transcript
  text at the end of the current editor contents. Typing, edits, and
  deletions made while waiting are preserved.
- Talk stops its recorder and socket when disabled or when the session
  shuts down.
- Audio and transcripts are not written to disk.

Terminals that send explicit Space repeat/release events use those
signals to detect a hold. In WezTerm's default mode and other
terminals without those events, Talk uses consecutive spaces from
keyboard repeat: at least three Space events over 300 ms, allowing up
to 650 ms for the first repeat and 180 ms between subsequent repeats.
A pause of 180 ms after repeats stops recording. Typing another key
cancels the sequence immediately; two Space taps are preserved as
ordinary input.

Without release events, repeated taps with the same timing as keyboard
repeat remain indistinguishable from a hold. Talk preserves existing
editor text even if such a sequence activates recording.

In `my-pi`, `--no-talk` prevents the built-in extension from loading
for one launch.

## Local development

```bash
pnpm --filter @spences10/pi-talk run build
pi install ./packages/pi-talk
# or for one run only
pi -e ./packages/pi-talk
```

## Using from a custom harness

```ts
import talk from "@spences10/pi-talk";

// Pass talk as an ExtensionFactory to your Pi runtime.
```

## Development

<!-- package-readme:development:start commands="check,test,build" -->

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-talk run check
pnpm --filter @spences10/pi-talk run test
pnpm --filter @spences10/pi-talk run build
```

<!-- package-readme:development:end -->

## License

MIT
