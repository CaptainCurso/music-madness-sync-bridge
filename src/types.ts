export type SyncDirection = "foundry_to_notion" | "notion_to_foundry";

export interface FoundryJournalSummary {
  id: string;
  name: string;
  folderId?: string;
  folderPath?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface FoundryMediaAsset {
  assetId?: string;
  sourceUrl: string;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface FoundryJournal extends FoundryJournalSummary {
  content: string;
  type?: string;
  aliases?: string[];
  media?: FoundryMediaAsset[];
}

export interface FoundryFolder {
  id: string;
  name: string;
  parentId?: string;
  path?: string[];
}

export interface SyncMap {
  foundry_type: string;
  foundry_id: string;
  notion_page_id: string;
  canonical_name: string;
  last_sync_direction: SyncDirection;
  source_hash: string;
  target_hash: string;
  last_synced_at: string;
  notion_mirror_block_id?: string | null;
}

export interface SyncConflict {
  conflict_id: string;
  foundry_id: string;
  notion_page_id: string;
  source_changed_at: string;
  target_changed_at: string;
  source_hash: string;
  target_hash: string;
  status: "open" | "resolved" | "ignored";
  operator_notes?: string | null;
}

export interface MediaMap {
  foundry_asset_id: string;
  source_url: string;
  stored_url_or_notion_file_id: string;
  checksum: string;
  size_bytes: number;
  last_validated_at: string;
}

export interface MediaCopyResult {
  foundryAssetId: string;
  sourceUrl: string;
  storedPath: string;
  storedReference: string;
  checksum: string;
  sizeBytes: number;
}

export interface JournalPreviewItem {
  journalId: string;
  title: string;
  notionPageId?: string;
  action: "create" | "update" | "skip" | "conflict";
  reason?: string;
  sourceHash: string;
}

export interface SyncPreviewResult {
  mode: "preview" | "apply";
  items: JournalPreviewItem[];
  summary: {
    create: number;
    update: number;
    skip: number;
    conflict: number;
  };
}
