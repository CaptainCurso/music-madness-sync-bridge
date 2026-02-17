#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const moduleDir = path.join(root, "foundry-module", "music-madness-bridge");
const moduleJsonPath = path.join(moduleDir, "module.json");

const required = [
  "MODULE_VERSION",
  "MODULE_URL",
  "MODULE_MANIFEST_URL",
  "MODULE_DOWNLOAD_URL"
];

for (const key of required) {
  if (!process.env[key] || !process.env[key].trim()) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

const version = process.env.MODULE_VERSION.trim();
const moduleUrl = process.env.MODULE_URL.trim();
const manifestUrl = process.env.MODULE_MANIFEST_URL.trim();
const downloadUrl = process.env.MODULE_DOWNLOAD_URL.trim();

const raw = fs.readFileSync(moduleJsonPath, "utf8");
const json = JSON.parse(raw);

json.version = version;
json.url = moduleUrl;
json.manifest = manifestUrl;
json.download = downloadUrl;

fs.writeFileSync(moduleJsonPath, `${JSON.stringify(json, null, 2)}\n`);

const releaseDir = path.join(root, "dist", "module-release");
fs.rmSync(releaseDir, { recursive: true, force: true });
fs.mkdirSync(releaseDir, { recursive: true });

const outputZip = path.join(releaseDir, `music-madness-bridge-v${version}.zip`);

// Build a zip containing the module folder root and exclude macOS metadata files.
execSync(
  `cd ${shellQuote(path.join(root, "foundry-module"))} && zip -r ${shellQuote(outputZip)} music-madness-bridge -x '*.DS_Store'`,
  { stdio: "inherit" }
);

console.log("Prepared Foundry module release:");
console.log(`- module.json updated: ${moduleJsonPath}`);
console.log(`- zip: ${outputZip}`);
console.log("\nNext:");
console.log("1. Commit module.json");
console.log("2. Create a GitHub release tag matching MODULE_VERSION");
console.log("3. Upload the zip asset to the release");
console.log("4. Use MODULE_MANIFEST_URL in Foundry Install Module by Manifest URL");

function shellQuote(value) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
