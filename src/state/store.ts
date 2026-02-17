import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";
import type { SyncConflict, SyncMap, MediaMap } from "../types.js";

export class StateStore {
  private constructor(private readonly dbPath: string, private readonly db: any) {}

  static async create(dataDir: string): Promise<StateStore> {
    const sqlDir = path.join(dataDir, "state");
    fs.mkdirSync(sqlDir, { recursive: true });

    const dbPath = path.join(sqlDir, "bridge.sqlite");
    const SQL = await initSqlJs({});

    const db = fs.existsSync(dbPath)
      ? new SQL.Database(new Uint8Array(fs.readFileSync(dbPath)))
      : new SQL.Database();

    const store = new StateStore(dbPath, db);
    store.initialize();
    store.persist();
    return store;
  }

  private initialize(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sync_map (
        foundry_type TEXT NOT NULL,
        foundry_id TEXT PRIMARY KEY,
        notion_page_id TEXT NOT NULL,
        canonical_name TEXT NOT NULL,
        last_sync_direction TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        target_hash TEXT NOT NULL,
        last_synced_at TEXT NOT NULL,
        notion_mirror_block_id TEXT
      );

      CREATE TABLE IF NOT EXISTS sync_conflicts (
        conflict_id TEXT PRIMARY KEY,
        foundry_id TEXT NOT NULL,
        notion_page_id TEXT NOT NULL,
        source_changed_at TEXT NOT NULL,
        target_changed_at TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        target_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        operator_notes TEXT
      );

      CREATE TABLE IF NOT EXISTS media_map (
        foundry_asset_id TEXT PRIMARY KEY,
        source_url TEXT NOT NULL,
        stored_url_or_notion_file_id TEXT NOT NULL,
        checksum TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        last_validated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_runs (
        run_id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        status TEXT NOT NULL,
        mode TEXT NOT NULL,
        summary_json TEXT
      );
    `);
  }

  private persist(): void {
    const bytes = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(bytes));
  }

  getSyncMap(foundryId: string): SyncMap | undefined {
    const result = this.db.exec("SELECT * FROM sync_map WHERE foundry_id = ?", [foundryId]);
    if (!result.length) return undefined;
    return this.rowToObject<SyncMap>(result[0]);
  }

  upsertSyncMap(map: SyncMap): void {
    this.db.run(
      `
      INSERT INTO sync_map (
        foundry_type, foundry_id, notion_page_id, canonical_name,
        last_sync_direction, source_hash, target_hash, last_synced_at,
        notion_mirror_block_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(foundry_id) DO UPDATE SET
        foundry_type=excluded.foundry_type,
        notion_page_id=excluded.notion_page_id,
        canonical_name=excluded.canonical_name,
        last_sync_direction=excluded.last_sync_direction,
        source_hash=excluded.source_hash,
        target_hash=excluded.target_hash,
        last_synced_at=excluded.last_synced_at,
        notion_mirror_block_id=excluded.notion_mirror_block_id
      `,
      [
        map.foundry_type,
        map.foundry_id,
        map.notion_page_id,
        map.canonical_name,
        map.last_sync_direction,
        map.source_hash,
        map.target_hash,
        map.last_synced_at,
        map.notion_mirror_block_id ?? null
      ]
    );
    this.persist();
  }

  insertConflict(conflict: SyncConflict): void {
    this.db.run(
      `
      INSERT OR REPLACE INTO sync_conflicts (
        conflict_id, foundry_id, notion_page_id, source_changed_at, target_changed_at,
        source_hash, target_hash, status, operator_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        conflict.conflict_id,
        conflict.foundry_id,
        conflict.notion_page_id,
        conflict.source_changed_at,
        conflict.target_changed_at,
        conflict.source_hash,
        conflict.target_hash,
        conflict.status,
        conflict.operator_notes ?? null
      ]
    );
    this.persist();
  }

  listConflicts(status: "open" | "resolved" | "ignored" | "all" = "open"): SyncConflict[] {
    const sql =
      status === "all"
        ? "SELECT * FROM sync_conflicts ORDER BY source_changed_at DESC"
        : "SELECT * FROM sync_conflicts WHERE status = ? ORDER BY source_changed_at DESC";
    const result = status === "all" ? this.db.exec(sql) : this.db.exec(sql, [status]);
    if (!result.length) return [];
    return this.rowsToObjects<SyncConflict>(result[0]);
  }

  updateConflictResolution(conflictId: string, status: "resolved" | "ignored", notes: string): boolean {
    this.db.run(
      "UPDATE sync_conflicts SET status = ?, operator_notes = ? WHERE conflict_id = ?",
      [status, notes, conflictId]
    );
    const changed = this.db.getRowsModified() > 0;
    if (changed) this.persist();
    return changed;
  }

  upsertMediaMap(row: MediaMap): void {
    this.db.run(
      `
      INSERT INTO media_map (
        foundry_asset_id, source_url, stored_url_or_notion_file_id,
        checksum, size_bytes, last_validated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(foundry_asset_id) DO UPDATE SET
        source_url=excluded.source_url,
        stored_url_or_notion_file_id=excluded.stored_url_or_notion_file_id,
        checksum=excluded.checksum,
        size_bytes=excluded.size_bytes,
        last_validated_at=excluded.last_validated_at
      `,
      [
        row.foundry_asset_id,
        row.source_url,
        row.stored_url_or_notion_file_id,
        row.checksum,
        row.size_bytes,
        row.last_validated_at
      ]
    );
    this.persist();
  }

  startRun(runId: string, mode: string, startedAt: string): void {
    this.db.run(
      "INSERT INTO sync_runs (run_id, started_at, status, mode) VALUES (?, ?, ?, ?)",
      [runId, startedAt, "running", mode]
    );
    this.persist();
  }

  finishRun(runId: string, status: "success" | "failed", endedAt: string, summary: unknown): void {
    this.db.run(
      "UPDATE sync_runs SET ended_at = ?, status = ?, summary_json = ? WHERE run_id = ?",
      [endedAt, status, JSON.stringify(summary), runId]
    );
    this.persist();
  }

  private rowToObject<T>(result: any): T {
    const row = result.values[0];
    const obj: Record<string, unknown> = {};
    result.columns.forEach((column: string, index: number) => {
      obj[column] = row[index];
    });
    return obj as T;
  }

  private rowsToObjects<T>(result: any): T[] {
    return result.values.map((row: unknown[]) => {
      const obj: Record<string, unknown> = {};
      result.columns.forEach((column: string, index: number) => {
        obj[column] = row[index];
      });
      return obj as T;
    });
  }
}
