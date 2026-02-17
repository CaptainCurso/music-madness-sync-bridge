# music-madness-bridge (Foundry Module)

This module provides authenticated read events for external bridge services.

## What it currently provides

- Socket event channel: `module.music-madness-bridge`
- Auth token setting at world scope
- Actions:
  - `health`
  - `list_journals`
  - `get_journal`
  - `journal_media`

## Why socket events, not direct HTTP

Foundry client modules run in the browser runtime. They cannot directly mount new server Express routes by themselves.

For strict HTTP route requirements (`GET /journals`, etc.), run a local proxy service that:
1. Receives HTTP requests.
2. Relays requests into this module socket event.
3. Returns the response as JSON.

The Node bridge in this repository is structured so that proxying can be added without changing sync logic.
