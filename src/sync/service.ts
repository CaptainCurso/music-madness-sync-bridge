import fs from "node:fs";
import path from "node:path";
import type pino from "pino";
import type { AppConfig } from "../config.js";
import { FoundryClient } from "../foundry/client.js";
import { MediaPipeline } from "../media/pipeline.js";
import { NotionAdapter } from "../notion/adapter.js";
import { StateStore } from "../state/store.js";
import type {
  FoundryJournal,
  JournalPreviewItem,
  SyncConflict,
  SyncMap,
  SyncPreviewResult,
  SyncDirection
} from "../types.js";
import { newId, sha256 } from "../utils/hash.js";
import { sleep } from "../utils/sleep.js";

export class SyncService {
  private readonly media: MediaPipeline;
  private readonly auditPath: string;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: pino.Logger,
    private readonly state: StateStore,
    private readonly foundry: FoundryClient,
    private readonly notion: NotionAdapter
  ) {
    this.media = new MediaPipeline(config, state, foundry);
    const logDir = path.join(config.bridgeDataDir, "logs");
    fs.mkdirSync(logDir, { recursive: true });
    this.auditPath = path.join(logDir, "audit.log");
  }

  async healthCheck(): Promise<unknown> {
    const foundry = await this.foundry.healthCheck();
    return {
      foundry,
      bridge: {
        storyBibleScope: this.config.notionStoryBiblePageId,
        allowedDatabases: this.config.notionAllowedDatabaseIds.length
      }
    };
  }

  async preview(options: {
    journalIds?: string[];
    dryRun?: boolean;
  }): Promise<SyncPreviewResult> {
    const journals = await this.loadJournals(options.journalIds);
    const items: JournalPreviewItem[] = [];

    for (const journal of journals) {
      const sourceHash = hashJournal(journal);
      const notionPageId = await this.notion.findPageByCanonicalOrAlias(journal.name, journal.aliases ?? []);
      const map = this.state.getSyncMap(journal.id);

      if (!notionPageId && !this.config.notionDefaultTargetDbId) {
        items.push({
          journalId: journal.id,
          title: journal.name,
          action: "skip",
          reason: "No canonical page match and NOTION_DEFAULT_TARGET_DB_ID is not configured.",
          sourceHash
        });
        continue;
      }

      if (map && notionPageId) {
        const maybeConflict = await this.detectConflict(map, sourceHash, notionPageId);
        if (maybeConflict) {
          items.push({
            journalId: journal.id,
            title: journal.name,
            notionPageId,
            action: "conflict",
            reason: "Source changed and Notion page was edited after last sync.",
            sourceHash
          });
          continue;
        }
      }

      items.push({
        journalId: journal.id,
        title: journal.name,
        notionPageId,
        action: notionPageId ? "update" : "create",
        sourceHash
      });
    }

    return {
      mode: options.dryRun ? "preview" : "preview",
      items,
      summary: summarize(items)
    };
  }

  async apply(options: {
    journalIds?: string[];
    includeMedia?: boolean;
    mode?: "incremental" | "full";
  }): Promise<SyncPreviewResult> {
    const runId = newId("run");
    const startedAt = new Date().toISOString();
    this.state.startRun(runId, options.mode ?? "incremental", startedAt);

    try {
      const preview = await this.preview({ journalIds: options.journalIds, dryRun: true });
      const journalsById = new Map((await this.loadJournals(options.journalIds)).map((j) => [j.id, j]));
      const items: JournalPreviewItem[] = [];

      for (const item of preview.items) {
        const journal = journalsById.get(item.journalId);
        if (!journal) continue;

        if (item.action === "skip") {
          items.push(item);
          continue;
        }

        if (item.action === "conflict") {
          const conflict = await this.buildConflict(journal, item.notionPageId!);
          this.state.insertConflict(conflict);
          await this.writeAudit("conflict_created", { journalId: journal.id, conflictId: conflict.conflict_id });
          items.push(item);
          continue;
        }

        const notionPageId =
          item.notionPageId ?? (await this.notion.createStoryBiblePage(journal.name, "Foundry Journal"));

        const mediaCopies = options.includeMedia ? await this.media.copyAll(journal.media ?? []) : [];
        const mirrorLines = buildMirrorLines(journal, mediaCopies, options.includeMedia ?? false);
        const targetHash = sha256(mirrorLines.join("\n"));
        const existingMap = this.state.getSyncMap(journal.id);

        const upsert = await this.notion.upsertFoundryMirror(
          notionPageId,
          mirrorLines,
          existingMap?.notion_mirror_block_id
        );

        const map: SyncMap = {
          foundry_type: "journal",
          foundry_id: journal.id,
          notion_page_id: notionPageId,
          canonical_name: journal.name,
          last_sync_direction: "foundry_to_notion" as SyncDirection,
          source_hash: item.sourceHash,
          target_hash: targetHash,
          last_synced_at: new Date().toISOString(),
          notion_mirror_block_id: upsert.mirrorBlockId
        };

        this.state.upsertSyncMap(map);

        await this.writeAudit("journal_synced", {
          journalId: journal.id,
          notionPageId,
          mediaCount: mediaCopies.length,
          action: item.action
        });

        items.push({ ...item, notionPageId, action: item.action });
        await sleep(this.config.syncRateLimitMs);
      }

      const result: SyncPreviewResult = {
        mode: "apply",
        items,
        summary: summarize(items)
      };

      this.state.finishRun(runId, "success", new Date().toISOString(), result.summary);
      return result;
    } catch (error) {
      this.state.finishRun(runId, "failed", new Date().toISOString(), {
        error: String(error)
      });
      throw error;
    }
  }

  listConflicts(status: "open" | "resolved" | "ignored" | "all" = "open") {
    return this.state.listConflicts(status);
  }

  resolveConflict(conflictId: string, resolution: "accept_foundry" | "accept_notion" | "manual_merge", notes: string) {
    const message = `[${resolution}] ${notes}`;
    return this.state.updateConflictResolution(conflictId, "resolved", message);
  }

  diff(source: string, target: string, objectType: string, objectId: string) {
    return {
      objectType,
      objectId,
      source,
      target,
      note: "Detailed semantic diff is not implemented yet. This returns the requested identity envelope."
    };
  }

  private async loadJournals(journalIds?: string[]): Promise<FoundryJournal[]> {
    if (journalIds?.length) {
      const items: FoundryJournal[] = [];
      for (const id of journalIds) {
        items.push(await this.foundry.getJournal(id));
      }
      return items;
    }

    const summaries = await this.foundry.listJournals({ limit: 200 });
    const journals: FoundryJournal[] = [];

    for (const summary of summaries) {
      journals.push(await this.foundry.getJournal(summary.id));
    }

    return journals;
  }

  private async detectConflict(map: SyncMap, newSourceHash: string, notionPageId: string): Promise<boolean> {
    if (map.source_hash === newSourceHash) return false;

    const editedAt = await this.notion.getPageLastEdited(notionPageId);
    return new Date(editedAt).getTime() > new Date(map.last_synced_at).getTime();
  }

  private async buildConflict(journal: FoundryJournal, notionPageId: string): Promise<SyncConflict> {
    const currentMap = this.state.getSyncMap(journal.id);
    return {
      conflict_id: newId("conflict"),
      foundry_id: journal.id,
      notion_page_id: notionPageId,
      source_changed_at: journal.updatedAt ?? new Date().toISOString(),
      target_changed_at: await this.notion.getPageLastEdited(notionPageId),
      source_hash: hashJournal(journal),
      target_hash: currentMap?.target_hash ?? "unknown",
      status: "open",
      operator_notes: "Conflict detected during apply. Manual resolution required."
    };
  }

  private async writeAudit(event: string, payload: unknown): Promise<void> {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      payload
    });
    fs.appendFileSync(this.auditPath, `${line}\n`);
    this.logger.info({ event, payload }, "audit_event");
  }
}

function hashJournal(journal: FoundryJournal): string {
  const basis = JSON.stringify({
    id: journal.id,
    name: journal.name,
    aliases: journal.aliases ?? [],
    updatedAt: journal.updatedAt,
    content: journal.content,
    media: (journal.media ?? []).map((m) => ({
      assetId: m.assetId,
      sourceUrl: m.sourceUrl,
      filename: m.filename,
      mimeType: m.mimeType
    }))
  });
  return sha256(basis);
}

function buildMirrorLines(
  journal: FoundryJournal,
  media: Array<{ storedReference: string; sourceUrl: string; checksum: string; sizeBytes: number; foundryAssetId: string }>,
  includeMedia: boolean
): string[] {
  const lines: string[] = [];
  lines.push(`Canonical Name: ${journal.name}`);
  lines.push(`Foundry Journal ID: ${journal.id}`);
  lines.push(`Last Synced: ${new Date().toISOString()}`);
  lines.push(`Foundry Updated At: ${journal.updatedAt ?? "unknown"}`);
  lines.push(`Aliases: ${(journal.aliases ?? []).join("; ")}`);
  lines.push("Type: Foundry Journal Mirror");
  lines.push("Current Status: Active");
  lines.push("Related Arcs: ");
  lines.push("Related Entities: ");
  lines.push("Related Locations: ");
  lines.push("Continuity Notes: Auto-generated mirror content. Non-destructive update.");
  lines.push("---");
  lines.push("Content:");

  const cleanedContent = journal.content
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  lines.push(cleanedContent.length ? cleanedContent : "(No content)");

  if (includeMedia) {
    lines.push("---");
    lines.push("Media:");
    if (!media.length) {
      lines.push("(No media found)");
    } else {
      for (const m of media) {
        lines.push(
          `- Asset ${m.foundryAssetId} | checksum=${m.checksum} | size=${m.sizeBytes} | source=${m.sourceUrl} | stored=${m.storedReference}`
        );
      }
    }
  }

  return lines;
}

function summarize(items: JournalPreviewItem[]) {
  return {
    create: items.filter((x) => x.action === "create").length,
    update: items.filter((x) => x.action === "update").length,
    skip: items.filter((x) => x.action === "skip").length,
    conflict: items.filter((x) => x.action === "conflict").length
  };
}
