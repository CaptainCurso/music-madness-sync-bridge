# Music and Madness Sync Bridge

This project implements Stage 1 of your plan:

- FoundryVTT -> Notion Story Bible journal mirroring
- Manual-run sync commands
- MCP tool surface for Codex/LLM orchestration
- Full media copy to durable local storage
- Conflict tracking with manual resolution
- Non-destructive writes under `Music and Madness Story Bible` with a top-level `Journals` wiki tree

## Project layout

- `/Users/nicholasmcdowell/Documents/Codex Projects/Music and Madness/music-madness-sync-bridge/src`
  - Bridge service, CLI, MCP server, Foundry/Notion adapters.
- `/Users/nicholasmcdowell/Documents/Codex Projects/Music and Madness/music-madness-sync-bridge/foundry-module/music-madness-bridge`
  - Foundry module scaffold exposing authenticated journal read events.
- `/Users/nicholasmcdowell/Documents/Codex Projects/Music and Madness/music-madness-sync-bridge/data`
  - Runtime state (`state/bridge.sqlite`), media copies (`media/`), logs (`logs/audit.log`).

## Definitions

- **MCP**: Model Context Protocol. Lets Codex call bridge tools like `sync.foundry_to_notion.apply`.
- **Mirror block**: Generated section under `## Foundry Mirror` in a Notion page.
- **Journals wiki tree**: A top-level Story Bible child page named `Journals`, with sub-pages matching Foundry folders.
- **Conflict**: Source and target changed since last sync, requiring manual decision.

## Setup

1. Copy env template.

```bash
cd '/Users/nicholasmcdowell/Documents/Codex Projects/Music and Madness/music-madness-sync-bridge'
cp .env.example .env
```

2. Fill `.env` values:
- Foundry URL/tokens
- Notion key
- Story Bible root page ID (`NOTION_STORY_BIBLE_PAGE_ID`)

3. Typecheck.

```bash
npm run typecheck
```

## Operator commands

Preview changes (no writes):

```bash
npm run sync:preview
```

`sync:preview` auto-starts the local proxy when `FOUNDRY_BASE_URL` is local (`127.0.0.1` / `localhost` / `::1`) and `FOUNDRY_AUTO_PROXY=1`.
Preview/write targets are wiki pages under `Journals`, not Notion databases.

Apply mirror updates:

```bash
npm run sync:apply
```

`sync:apply` has the same auto-proxy behavior and stops the proxy afterward only if this command started it.
When creating a page, it mirrors Foundry folder structure under the `Journals` wiki tree.
Media download/linking is enabled by default; disable with `--no-include-media`.

List conflicts:

```bash
npm run sync:conflicts
```

Resolve one conflict:

```bash
npm run sync:resolve -- --conflict-id <id> --resolution manual_merge --notes "Reviewed and merged"
```

Health check:

```bash
tsx src/cli.ts health
```

## MCP server

Run stdio MCP server:

```bash
npm run mcp:start
```

Exposed tools:

- `foundry.health_check`
- `foundry.list_journals`
- `foundry.get_journal`
- `foundry.export_journal_media`
- `sync.foundry_to_notion.preview`
- `sync.foundry_to_notion.apply`
- `sync.diff`
- `sync.conflicts.list`
- `sync.conflicts.resolve`

## Guardrails enforced

- Only writes to Notion pages in `NOTION_ALLOWED_DATABASE_IDS`.
- Existing prose preserved by appending/updating generated mirror block.
- Legacy `Music and Madness` section is untouched by default because database scope is explicit.

## Known limitations in this initial implementation

- Foundry HTTP routes are expected at `/health`, `/journals`, `/journals/:id`, etc.
- The Foundry module included here is an authenticated socket/event scaffold. If you need direct HTTP routes from Foundry itself, run a small local proxy (or use an API module) that maps those routes to module events.
- Media is copied to local durable files. To render media directly inside cloud Notion reliably, set `MEDIA_PUBLIC_BASE_URL` to a reachable static host.

## Local test bridge API (optional)

If your Foundry module routes are not live yet, run the mock API that implements:

- `GET /health`
- `GET /journals`
- `GET /journals/:id`
- `GET /journals/:id/media`
- `GET /assets/:assetId`
- `GET /changes?since=`

Command:

```bash
npm run foundry:mock-api
```

Fixture data file:

- `/Users/nicholasmcdowell/Documents/Codex Projects/Music and Madness/music-madness-sync-bridge/fixtures/foundry-fixture.json`

## Real Foundry proxy (Socket.IO -> HTTP routes)

Use this when your Foundry world and `music-madness-bridge` module are running.

### Why this exists

Your sync client expects HTTP routes (`/journals`, `/health`, etc.).
The Foundry module communicates via socket events in-world.
This proxy translates HTTP calls to socket event calls.

### Start order

1. Start Foundry and open the target world.
2. Ensure module `music-madness-bridge` is enabled.
3. In Foundry world settings, set `Bridge Token` to the same value as `.env` `FOUNDRY_BRIDGE_TOKEN`.
4. Populate in `.env`:
   - `FOUNDRY_SITE_URL`
   - `FOUNDRY_WORLD`
   - `FOUNDRY_SESSION_COOKIE`
   - `FOUNDRY_BRIDGE_TOKEN`
5. Start proxy:

```bash
npm run foundry:proxy
```

6. In another terminal, run bridge operations:

```bash
npm run sync:preview
npm run sync:apply
```

### Session cookie note

`FOUNDRY_SESSION_COOKIE` is the value of the `session` cookie from a browser already logged into your Foundry world.
Treat it like a secret token.

### Current limitation

`GET /assets/:assetId` returns `501` in socket-proxy mode unless your module adds binary asset streaming.
Media still syncs from journal-linked `sourceUrl` values where accessible.

## Remote Foundry host (LAN)

If Foundry runs on another machine on your network, set:

```bash
FOUNDRY_SITE_URL=http://192.168.1.105:30000/
```

Keep the sync client pointed at your **local proxy**:

```bash
FOUNDRY_BASE_URL=http://127.0.0.1:8788
```

So the flow is:

- this laptop sync client -> local proxy (`127.0.0.1:8788`)
- local proxy -> remote Foundry (`192.168.1.105:30000`)

You still need:
- `FOUNDRY_WORLD` for that remote Foundry world
- `FOUNDRY_SESSION_COOKIE` from a browser logged into that remote Foundry
- matching `FOUNDRY_BRIDGE_TOKEN` in Foundry module world settings

## Remote diagnostic command

Run this before sync to verify remote Foundry + proxy health.
This command does **not** auto-start proxy; start it explicitly first with `npm run foundry:proxy`.

```bash
npm run health:remote
```

What it checks:
- `FOUNDRY_SITE_URL` HTTP reachability
- local proxy `/health` response and socket connection state
- local proxy `/journals` route response

Exit code is non-zero if any check fails.

Verbose diagnostics with remediation hints:

```bash
npm run health:remote -- --verbose
```

## Doctor command

Validate your `.env` before running proxy or sync:

```bash
npm run doctor
```

What it validates:
- required env variables are present
- URL formats (`FOUNDRY_BASE_URL`, `FOUNDRY_SITE_URL`)
- Notion DB scope consistency (`NOTION_DEFAULT_TARGET_DB_ID` is in `NOTION_ALLOWED_DATABASE_IDS`)
- proxy port sanity
- basic shape checks for world slug and session cookie

Exit code is non-zero when required checks fail.


## Remote module install (manifest URL)

For one-click Foundry install/update via URL, use the release workflow guide:

- `/Users/nicholasmcdowell/Documents/Codex Projects/Music and Madness/music-madness-sync-bridge/docs/foundry_remote_install.md`

Quick command (example):

```bash
MODULE_VERSION=0.1.0 MODULE_URL=https://github.com/<you>/<repo> MODULE_MANIFEST_URL=https://raw.githubusercontent.com/<you>/<repo>/main/foundry-module/music-madness-bridge/module.json MODULE_DOWNLOAD_URL=https://github.com/<you>/<repo>/releases/download/v0.1.0/music-madness-bridge-v0.1.0.zip node scripts/release/prepare-foundry-module.mjs
```
