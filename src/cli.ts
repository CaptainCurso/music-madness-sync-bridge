#!/usr/bin/env node
import { Command } from "commander";
import { createAppContext } from "./app-context.js";
import { runRemoteHealth } from "./diagnostics/remote-health.js";
import { runDoctor } from "./diagnostics/doctor.js";
import { ensureProxyForSync } from "./foundry/proxy-lifecycle.js";

const program = new Command();
program.name("music-madness-sync").description("Foundry <-> Story Bible sync operator CLI");

const syncCommand = program.command("sync").description("Sync operations");

syncCommand
  .command("preview")
  .description("Preview Foundry -> Notion changes without writing")
  .option("--journal-id <id...>", "Specific Foundry journal IDs")
  .action(async (options) => {
    const app = await createAppContext();
    const proxy = await ensureProxyForSync(app.config, { label: "sync preview" });
    try {
      const result = await app.sync.preview({ journalIds: options.journalId, dryRun: true });
      console.log(JSON.stringify(result, null, 2));
    } finally {
      await proxy.stop();
    }
  });

syncCommand
  .command("apply")
  .description("Apply Foundry -> Notion mirror updates")
  .option("--journal-id <id...>", "Specific Foundry journal IDs")
  .option("--no-include-media", "Disable media download/linking (enabled by default)")
  .option("--mode <mode>", "incremental|full", "incremental")
  .action(async (options) => {
    const app = await createAppContext();
    const proxy = await ensureProxyForSync(app.config, { label: "sync apply" });
    try {
      const result = await app.sync.apply({
        journalIds: options.journalId,
        includeMedia: Boolean(options.includeMedia),
        mode: options.mode
      });
      console.log(JSON.stringify(result, null, 2));
    } finally {
      await proxy.stop();
    }
  });

syncCommand
  .command("conflicts")
  .description("List sync conflicts")
  .option("--status <status>", "open|resolved|ignored|all", "open")
  .action(async (options) => {
    const app = await createAppContext();
    const rows = app.sync.listConflicts(options.status);
    console.log(JSON.stringify(rows, null, 2));
  });

syncCommand
  .command("resolve")
  .description("Resolve a sync conflict manually")
  .requiredOption("--conflict-id <id>", "Conflict ID")
  .requiredOption("--resolution <resolution>", "accept_foundry|accept_notion|manual_merge")
  .option("--notes <notes>", "Operator notes", "Resolved manually")
  .action(async (options) => {
    const app = await createAppContext();
    const ok = app.sync.resolveConflict(options.conflictId, options.resolution, options.notes);
    console.log(JSON.stringify({ ok }, null, 2));
    if (!ok) process.exitCode = 1;
  });



program
  .command("doctor")
  .description("Validate .env configuration before network operations")
  .action(async () => {
    const report = runDoctor();
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  });

program
  .command("health:remote")
  .description("Check remote Foundry host reachability and local proxy socket readiness")
  .option("--verbose", "Include actionable remediation hints", false)
  .action(async (options) => {
    const report = await runRemoteHealth(Boolean(options.verbose));
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  });

program
  .command("health")
  .description("Check Foundry connectivity and local bridge scope")
  .action(async () => {
    const app = await createAppContext();
    const report = await app.sync.healthCheck();
    console.log(JSON.stringify(report, null, 2));
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error);
  process.exit(1);
});
