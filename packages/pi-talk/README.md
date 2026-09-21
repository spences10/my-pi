# @spences10/pi-talk

Hold Space to dictate into Pi. Release Space to transcribe. A quick
tap still inserts one space.

Talk is off by default and does not intercept Space until you set it
up.

## Requirements

- Linux with PipeWire's `pw-record`
- Deepgram API key

## Install

```bash
pi install npm:@spences10/pi-talk
```

Then run:

```text
/talk setup
```

The setup prompt masks the key and stores it in
`~/.pi/agent/my-pi-secrets.json`. The file uses `0600` permissions.
The key is not added to the conversation or Pi session history.

Commands:

```text
/talk setup   Store a Deepgram key and enable Talk
/talk on      Enable Talk with the stored or environment key
/talk off     Disable Talk without deleting the stored key
/talk forget  Disable Talk and delete the stored key
/talk status  Show enablement and key availability
```

`DEEPGRAM_API_KEY` or `DEEPGRAM` can provide the key without storing
it. Talk still remains off until `/talk on` is run.

For local development:

```bash
pnpm --filter @spences10/pi-talk run build
pi -e ./packages/pi-talk
```

The transcript is inserted into the editor. It is not submitted.
