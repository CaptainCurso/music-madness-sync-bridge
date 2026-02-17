# Foundry Remote Install (GitHub Manifest Workflow)

This guide lets you install/update `music-madness-bridge` in Foundry using a manifest URL.

## Where the module is

- Module source folder:
  - `/Users/nicholasmcdowell/Documents/Codex Projects/Music and Madness/music-madness-sync-bridge/foundry-module/music-madness-bridge`
- Module manifest file:
  - `/Users/nicholasmcdowell/Documents/Codex Projects/Music and Madness/music-madness-sync-bridge/foundry-module/music-madness-bridge/module.json`

## Terms

- **Manifest URL**: the public URL to `module.json` that Foundry reads to install/update a module.
- **Download URL**: public URL to the release zip file Foundry downloads.

## Recommended hosting (GitHub)

1. Create a GitHub repository for this bridge project (or module-only repo).
2. Push the module folder to the repo.
3. Make sure `module.json` is committed.

## Prepare a release build

From:

- `/Users/nicholasmcdowell/Documents/Codex Projects/Music and Madness/music-madness-sync-bridge`

Run:

```bash
MODULE_VERSION=0.1.0 \
MODULE_URL=https://github.com/<you>/<repo> \
MODULE_MANIFEST_URL=https://raw.githubusercontent.com/<you>/<repo>/main/foundry-module/music-madness-bridge/module.json \
MODULE_DOWNLOAD_URL=https://github.com/<you>/<repo>/releases/download/v0.1.0/music-madness-bridge-v0.1.0.zip \
node scripts/release/prepare-foundry-module.mjs
```

What this does:

- Updates `module.json` fields:
  - `version`
  - `url`
  - `manifest`
  - `download`
- Produces a release zip at:
  - `dist/module-release/music-madness-bridge-v<version>.zip`

Risk:

- It edits `module.json` in place. Review before committing.

## Publish on GitHub

1. Commit updated `module.json`.
2. Create tag/release `v<version>`.
3. Upload zip from `dist/module-release/` to that release.

## Install in Foundry

In Foundry:

1. Go to **Add-on Modules**.
2. Click **Install Module**.
3. Paste your `MODULE_MANIFEST_URL`.
4. Install and enable `music-madness-bridge` in your world.

## Update flow

For each new version:

1. Bump `MODULE_VERSION`.
2. Re-run `prepare-foundry-module.mjs` with new URLs.
3. Publish new release/tag and zip.
4. In Foundry, update module.
