import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createAppContext } from "../app-context.js";

const appPromise = createAppContext();

const server = new McpServer({
  name: "music-madness-sync-bridge",
  version: "0.1.0"
});

server.registerTool("foundry.health_check", {
  description: "Check Foundry bridge reachability and local scope locks.",
  inputSchema: {}
}, async () => {
  const app = await appPromise;
  const report = await app.sync.healthCheck();
  return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
});

server.registerTool("foundry.list_journals", {
  description: "List Foundry journal entries.",
  inputSchema: {
    folder: z.string().optional(),
    updated_after: z.string().optional(),
    limit: z.number().int().positive().max(500).optional()
  }
}, async (input) => {
  const app = await appPromise;
  const rows = await app.foundry.listJournals({
    folder: input.folder,
    updatedAfter: input.updated_after,
    limit: input.limit
  });
  return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
});

server.registerTool("foundry.get_journal", {
  description: "Get one Foundry journal by ID.",
  inputSchema: {
    journal_id: z.string().min(1)
  }
}, async ({ journal_id }) => {
  const app = await appPromise;
  const row = await app.foundry.getJournal(journal_id);
  return { content: [{ type: "text", text: JSON.stringify(row, null, 2) }] };
});

server.registerTool("foundry.export_journal_media", {
  description: "List media assets for a Foundry journal.",
  inputSchema: {
    journal_id: z.string().min(1)
  }
}, async ({ journal_id }) => {
  const app = await appPromise;
  const rows = await app.foundry.exportJournalMedia(journal_id);
  return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
});

server.registerTool("sync.foundry_to_notion.preview", {
  description: "Preview Foundry -> Story Bible mirror updates.",
  inputSchema: {
    journal_ids: z.array(z.string()).optional(),
    dry_run: z.boolean().default(true)
  }
}, async ({ journal_ids }) => {
  const app = await appPromise;
  const result = await app.sync.preview({ journalIds: journal_ids, dryRun: true });
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

server.registerTool("sync.foundry_to_notion.apply", {
  description: "Apply Foundry -> Story Bible mirror updates.",
  inputSchema: {
    journal_ids: z.array(z.string()).optional(),
    include_media: z.boolean().default(true),
    mode: z.enum(["incremental", "full"]).default("incremental")
  }
}, async ({ journal_ids, include_media, mode }) => {
  const app = await appPromise;
  const result = await app.sync.apply({ journalIds: journal_ids, includeMedia: include_media, mode });
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

server.registerTool("sync.diff", {
  description: "Show an identity-level diff envelope for a sync object.",
  inputSchema: {
    source: z.string(),
    target: z.string(),
    object_type: z.string(),
    object_id: z.string()
  }
}, async ({ source, target, object_type, object_id }) => {
  const app = await appPromise;
  const diff = app.sync.diff(source, target, object_type, object_id);
  return { content: [{ type: "text", text: JSON.stringify(diff, null, 2) }] };
});

server.registerTool("sync.conflicts.list", {
  description: "List sync conflicts.",
  inputSchema: {
    status: z.enum(["open", "resolved", "ignored", "all"]).default("open")
  }
}, async ({ status }) => {
  const app = await appPromise;
  const rows = app.sync.listConflicts(status);
  return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
});

server.registerTool("sync.conflicts.resolve", {
  description: "Resolve a sync conflict manually.",
  inputSchema: {
    conflict_id: z.string().min(1),
    resolution: z.enum(["accept_foundry", "accept_notion", "manual_merge"]),
    notes: z.string().default("Resolved manually")
  }
}, async ({ conflict_id, resolution, notes }) => {
  const app = await appPromise;
  const ok = app.sync.resolveConflict(conflict_id, resolution, notes);
  return { content: [{ type: "text", text: JSON.stringify({ ok }, null, 2) }] };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
