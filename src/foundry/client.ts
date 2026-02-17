import { extractMediaUrls, filenameFromUrl } from "../utils/media.js";
import type { AppConfig } from "../config.js";
import type { FoundryFolder, FoundryJournal, FoundryJournalSummary, FoundryMediaAsset } from "../types.js";

export class FoundryClient {
  constructor(private readonly config: AppConfig) {}

  async healthCheck(): Promise<{ ok: boolean; raw: unknown }> {
    const raw = await this.requestJson("/health");
    return { ok: true, raw };
  }

  async listJournals(params?: {
    folder?: string;
    updatedAfter?: string;
    limit?: number;
  }): Promise<FoundryJournalSummary[]> {
    const query = new URLSearchParams();
    if (params?.folder) query.set("folder", params.folder);
    if (params?.updatedAfter) query.set("updated_after", params.updatedAfter);
    if (params?.limit) query.set("limit", String(params.limit));

    const suffix = query.toString() ? `/journals?${query}` : "/journals";
    const raw = (await this.requestJson(suffix)) as { journals?: any[] };

    return (raw.journals ?? []).map((j) => ({
      id: String(j.id),
      name: String(j.name ?? j.title ?? "Untitled Journal"),
      folderId: j.folderId ? String(j.folderId) : undefined,
      folderPath: Array.isArray(j.folderPath) ? j.folderPath.map((x: unknown) => String(x)) : undefined,
      createdAt: j.createdAt ? String(j.createdAt) : undefined,
      updatedAt: j.updatedAt ? String(j.updatedAt) : undefined
    }));
  }

  async getJournal(journalId: string): Promise<FoundryJournal> {
    const raw = (await this.requestJson(`/journals/${encodeURIComponent(journalId)}`)) as any;

    const content = String(raw.content ?? raw.text ?? "");
    const apiMedia: FoundryMediaAsset[] = Array.isArray(raw.media)
      ? raw.media.map((m: any) => ({
          assetId: m.assetId ? String(m.assetId) : undefined,
          sourceUrl: String(m.sourceUrl ?? m.url ?? ""),
          filename: m.filename ? String(m.filename) : undefined,
          mimeType: m.mimeType ? String(m.mimeType) : undefined,
          sizeBytes: Number.isFinite(Number(m.sizeBytes)) ? Number(m.sizeBytes) : undefined
        }))
      : [];

    const htmlMedia = extractMediaUrls(content).map((url) => ({
      sourceUrl: url,
      filename: filenameFromUrl(url)
    }));

    const mergedMedia = dedupeMedia([...apiMedia, ...htmlMedia]);

    return {
      id: String(raw.id ?? journalId),
      name: String(raw.name ?? raw.title ?? "Untitled Journal"),
      folderId: raw.folderId ? String(raw.folderId) : undefined,
      folderPath: Array.isArray(raw.folderPath) ? raw.folderPath.map((x: unknown) => String(x)) : undefined,
      createdAt: raw.createdAt ? String(raw.createdAt) : undefined,
      updatedAt: raw.updatedAt ? String(raw.updatedAt) : undefined,
      aliases: Array.isArray(raw.aliases) ? raw.aliases.map((x: unknown) => String(x)) : [],
      type: raw.type ? String(raw.type) : undefined,
      content,
      media: mergedMedia
    };
  }

  async listFolders(): Promise<FoundryFolder[]> {
    const raw = (await this.requestJson("/folders")) as { folders?: any[] };
    return (raw.folders ?? []).map((f: any) => ({
      id: String(f.id),
      name: String(f.name ?? "Unnamed Folder"),
      parentId: f.parentId ? String(f.parentId) : undefined,
      path: Array.isArray(f.path) ? f.path.map((x: unknown) => String(x)) : undefined
    }));
  }

  async exportJournalMedia(journalId: string): Promise<FoundryMediaAsset[]> {
    const raw = (await this.requestJson(`/journals/${encodeURIComponent(journalId)}/media`)) as {
      media?: any[];
    };

    return (raw.media ?? []).map((m: any) => ({
      assetId: m.assetId ? String(m.assetId) : undefined,
      sourceUrl: String(m.sourceUrl ?? m.url ?? ""),
      filename: m.filename ? String(m.filename) : undefined,
      mimeType: m.mimeType ? String(m.mimeType) : undefined,
      sizeBytes: Number.isFinite(Number(m.sizeBytes)) ? Number(m.sizeBytes) : undefined
    }));
  }

  async downloadAsset(asset: FoundryMediaAsset): Promise<{
    bytes: Buffer;
    mimeType?: string;
    finalUrl: string;
  }> {
    const candidates: string[] = [];
    if (asset.assetId) {
      candidates.push(`/assets/${encodeURIComponent(asset.assetId)}`);
    }
    if (asset.sourceUrl) {
      candidates.push(asset.sourceUrl);
    }

    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        const response = await this.requestRaw(candidate);
        const bytes = Buffer.from(await response.arrayBuffer());
        const mimeType = response.headers.get("content-type") ?? asset.mimeType ?? undefined;
        return { bytes, mimeType, finalUrl: response.url };
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(`Failed to download asset. Last error: ${String(lastError)}`);
  }

  private async requestJson(pathOrAbsoluteUrl: string): Promise<unknown> {
    const response = await this.requestRaw(pathOrAbsoluteUrl);
    return response.json();
  }

  private async requestRaw(pathOrAbsoluteUrl: string): Promise<Response> {
    const url = pathOrAbsoluteUrl.startsWith("http")
      ? pathOrAbsoluteUrl
      : `${this.config.foundryBaseUrl}${pathOrAbsoluteUrl}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.foundryRequestTimeoutMs);

    const headers: HeadersInit = {
      Authorization: `Bearer ${this.config.foundryApiToken}`
    };

    if (this.config.foundryBridgeToken) {
      headers["X-Bridge-Token"] = this.config.foundryBridgeToken;
    }

    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Foundry request failed (${response.status}) ${url}: ${text}`);
      }

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function dedupeMedia(items: FoundryMediaAsset[]): FoundryMediaAsset[] {
  const map = new Map<string, FoundryMediaAsset>();
  for (const item of items) {
    if (!item.sourceUrl) continue;
    if (!map.has(item.sourceUrl)) {
      map.set(item.sourceUrl, item);
    }
  }
  return [...map.values()];
}
