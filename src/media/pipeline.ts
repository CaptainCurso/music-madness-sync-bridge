import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config.js";
import { StateStore } from "../state/store.js";
import type { FoundryClient } from "../foundry/client.js";
import type { FoundryMediaAsset, MediaCopyResult } from "../types.js";
import { extensionFromMimeOrName, filenameFromUrl } from "../utils/media.js";
import { sha256 } from "../utils/hash.js";

export class MediaPipeline {
  private readonly mediaDir: string;

  constructor(
    private readonly config: AppConfig,
    private readonly state: StateStore,
    private readonly foundryClient: FoundryClient
  ) {
    this.mediaDir = path.join(this.config.bridgeDataDir, "media");
    fs.mkdirSync(this.mediaDir, { recursive: true });
  }

  async copyAll(assets: FoundryMediaAsset[]): Promise<MediaCopyResult[]> {
    const copied: MediaCopyResult[] = [];

    for (const asset of assets) {
      if (!asset.sourceUrl && !asset.assetId) continue;

      const downloaded = await this.foundryClient.downloadAsset(asset);
      const checksum = sha256(downloaded.bytes);
      const ext = extensionFromMimeOrName(asset.mimeType ?? downloaded.mimeType, asset.filename ?? filenameFromUrl(asset.sourceUrl));
      const filename = `${checksum}.${ext}`;
      const absolutePath = path.join(this.mediaDir, filename);

      if (!fs.existsSync(absolutePath)) {
        fs.writeFileSync(absolutePath, downloaded.bytes);
      }

      const storedReference = this.config.mediaPublicBaseUrl
        ? `${this.config.mediaPublicBaseUrl}/media/${filename}`
        : absolutePath;

      const foundryAssetId = asset.assetId ?? checksum;

      this.state.upsertMediaMap({
        foundry_asset_id: foundryAssetId,
        source_url: asset.sourceUrl,
        stored_url_or_notion_file_id: storedReference,
        checksum,
        size_bytes: downloaded.bytes.length,
        last_validated_at: new Date().toISOString()
      });

      copied.push({
        foundryAssetId,
        sourceUrl: asset.sourceUrl,
        storedPath: absolutePath,
        storedReference,
        checksum,
        sizeBytes: downloaded.bytes.length
      });
    }

    return copied;
  }
}
