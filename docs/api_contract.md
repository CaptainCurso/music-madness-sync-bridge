# Foundry Bridge API Contract

The sync client consumes these HTTP routes from `FOUNDRY_BASE_URL`.
In production for this project, these routes are usually served by the local socket proxy:

- `/Users/nicholasmcdowell/Documents/Codex Projects/Music and Madness/music-madness-sync-bridge/src/foundry/socket-proxy-server.ts`

All routes expect:
- `Authorization: Bearer <FOUNDRY_API_TOKEN>`
- Optional `X-Bridge-Token: <FOUNDRY_BRIDGE_TOKEN>` when your endpoint enforces it.

## GET /health
Returns bridge status metadata.

## GET /journals
Query params:
- `folder`
- `updated_after`
- `limit`

Response:
```json
{ "journals": [{ "id": "...", "name": "...", "updatedAt": "..." }] }
```

## GET /journals/:id
Returns full journal payload:
- `id`
- `name`
- `aliases`
- `updatedAt`
- `content` (HTML/text)
- `media` array (optional)

## GET /journals/:id/media
Returns media asset list:
```json
{ "media": [{ "assetId": "...", "sourceUrl": "...", "filename": "...", "mimeType": "..." }] }
```

## GET /assets/:assetId
Binary stream for media asset.

Note: current socket-proxy implementation returns `501` for this route unless asset streaming is added to the Foundry module.

## GET /changes?since=<cursor>
Incremental change feed.

Note: current socket-proxy implementation returns an empty list in Stage 1.
