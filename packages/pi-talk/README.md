# @spences10/pi-talk

Hold Space to dictate into Pi. Release Space to transcribe. A quick
tap still inserts one space.

## Requirements

- Linux with PipeWire's `pw-record`
- A terminal that sends Kitty keyboard release events
- `DEEPGRAM_API_KEY` or `DEEPGRAM` in Pi's environment

## Install

```bash
pi install npm:@spences10/pi-talk
```

For local development:

```bash
pnpm --filter @spences10/pi-talk run build
pi -e ./packages/pi-talk
```

The transcript is inserted into the editor. It is not submitted.
