#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const packageJsonPath = path.join(root, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const version = String(packageJson.version || "").trim();

if (!version) {
  fail(`Could not read version from ${packageJsonPath}`);
}

const tag = `v${version}`;
const zipPath = path.join(
  root,
  "dist",
  "module-release",
  `music-madness-bridge-v${version}.zip`
);

if (!fs.existsSync(zipPath)) {
  fail(
    `Release zip not found: ${zipPath}\nRun: npm run module:prepare-release`
  );
}

const gh = resolveGhBinary();

run(gh, ["auth", "status"], "GitHub CLI is not authenticated.");

const releaseExists = checkReleaseExists(gh, tag);

if (!releaseExists) {
  run(gh, ["release", "create", tag, "--title", tag, "--notes", `Release ${tag}`]);
}

run(gh, ["release", "upload", tag, zipPath, "--clobber"]);

console.log("Published GitHub release asset:");
console.log(`- tag: ${tag}`);
console.log(`- asset: ${zipPath}`);

function checkReleaseExists(ghBin, releaseTag) {
  try {
    execFileSync(ghBin, ["release", "view", releaseTag], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function resolveGhBinary() {
  const candidates = [
    process.env.GH_BIN,
    "gh",
    path.join(process.env.HOME || "", ".local", "bin", "gh")
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      return candidate;
    } catch {
      // keep checking
    }
  }

  fail(
    "GitHub CLI (gh) not found. Install it first, then re-run this command."
  );
}

function run(bin, args, customError) {
  try {
    execFileSync(bin, args, { stdio: "inherit" });
  } catch (error) {
    if (customError) {
      fail(`${customError}\nCommand failed: ${bin} ${args.join(" ")}`);
    }
    throw error;
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
