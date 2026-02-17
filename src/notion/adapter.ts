import { Client } from "@notionhq/client";
import type { AppConfig } from "../config.js";

const JOURNALS_ROOT_TITLE = "Journals";
const NOTION_RICH_TEXT_MAX = 1900;
const NOTION_CHILDREN_APPEND_LIMIT = 100;

export class NotionAdapter {
  private readonly notion: Client;

  constructor(private readonly config: AppConfig) {
    this.notion = new Client({ auth: config.notionApiKey });
  }

  async findPageByCanonicalOrAlias(
    canonicalName: string,
    aliases: string[],
    folderPath: string[] = []
  ): Promise<string | undefined> {
    const parentPageId = await this.findFolderParentPageId(folderPath);
    if (!parentPageId) return undefined;

    const terms = [canonicalName, ...aliases].map((x) => x.trim()).filter(Boolean);
    for (const term of terms) {
      const existing = await this.findChildPageByTitle(parentPageId, term);
      if (existing) return existing;
    }

    return undefined;
  }

  async ensureJournalPage(
    canonicalName: string,
    folderPath: string[],
    typeLabel = "Foundry Journal"
  ): Promise<string> {
    const parentPageId = await this.ensureFolderParentPageId(folderPath);
    const existing = await this.findChildPageByTitle(parentPageId, canonicalName);
    if (existing) return existing;

    const created = await this.notion.pages.create({
      parent: { page_id: parentPageId },
      properties: {
        title: {
          title: [{ type: "text", text: { content: canonicalName } }]
        }
      }
    } as any);

    await this.notion.blocks.children.append({
      block_id: created.id,
      children: [
        paragraph(`Canonical Name: ${canonicalName}`),
        paragraph("Aliases: "),
        paragraph(`Type: ${typeLabel}`),
        paragraph("Current Status: Active"),
        paragraph("Related Arcs: "),
        paragraph("Related Entities: "),
        paragraph("Related Locations: "),
        paragraph("Continuity Notes: Created by bridge sync."),
        paragraph(`Last Updated: ${new Date().toISOString().slice(0, 10)}`)
      ]
    });

    return created.id;
  }

  async createStoryBiblePage(canonicalName: string, typeLabel = "Foundry Journal"): Promise<string> {
    return this.ensureJournalPage(canonicalName, [], typeLabel);
  }

  async getPageLastEdited(pageId: string): Promise<string> {
    const page = (await this.notion.pages.retrieve({ page_id: pageId })) as any;
    return String(page.last_edited_time ?? new Date(0).toISOString());
  }

  async upsertFoundryMirror(
    pageId: string,
    mirrorPayload: {
      metadataLines: string[];
      contentText: string;
      media: Array<{
        storedReference: string;
        sourceUrl: string;
        checksum: string;
        sizeBytes: number;
        foundryAssetId: string;
      }>;
      includeMedia: boolean;
    },
    previousMirrorBlockId?: string | null
  ): Promise<{ mirrorBlockId: string }> {
    if (previousMirrorBlockId) {
      try {
        await this.notion.blocks.delete({ block_id: previousMirrorBlockId });
      } catch {
        // Ignore missing block errors and continue.
      }
    }

    const children = await this.notion.blocks.children.list({ block_id: pageId, page_size: 100 });
    const hasHeading = children.results.some((block: any) => {
      if (block.type !== "heading_2") return false;
      return richTextToPlainText(block.heading_2?.rich_text ?? []).trim() === "Foundry Mirror";
    });

    if (!hasHeading) {
      await this.notion.blocks.children.append({
        block_id: pageId,
        children: [
          {
            heading_2: {
              rich_text: [{ type: "text", text: { content: "Foundry Mirror" } }]
            }
          }
        ] as any
      });
    }

    const generatedBlocks = toGeneratedBlocks(mirrorPayload);

    const containerResponse = await this.notion.blocks.children.append({
      block_id: pageId,
      children: [
        {
          callout: {
            rich_text: [
              {
                type: "text",
                text: {
                  content: `Foundry Mirror (auto) - ${new Date().toISOString()}`
                }
              }
            ]
          }
        }
      ] as any
    });

    const first = containerResponse.results[0] as any;
    const containerId = first.id as string;

    for (const chunk of chunkBlocks(generatedBlocks, NOTION_CHILDREN_APPEND_LIMIT)) {
      await this.notion.blocks.children.append({
        block_id: containerId,
        children: chunk as any
      });
    }

    return { mirrorBlockId: containerId };
  }

  private async findFolderParentPageId(folderPath: string[]): Promise<string | undefined> {
    const rootId = await this.findJournalsRootPageId();
    if (!rootId) return undefined;

    let currentParent = rootId;
    for (const segment of sanitizePath(folderPath)) {
      const next = await this.findChildPageByTitle(currentParent, segment);
      if (!next) return undefined;
      currentParent = next;
    }
    return currentParent;
  }

  private async ensureFolderParentPageId(folderPath: string[]): Promise<string> {
    let currentParent = await this.ensureJournalsRootPageId();
    for (const segment of sanitizePath(folderPath)) {
      currentParent = await this.ensureChildPageByTitle(currentParent, segment);
    }
    return currentParent;
  }

  private async findJournalsRootPageId(): Promise<string | undefined> {
    return this.findChildPageByTitle(this.config.notionStoryBiblePageId, JOURNALS_ROOT_TITLE);
  }

  private async ensureJournalsRootPageId(): Promise<string> {
    return this.ensureChildPageByTitle(this.config.notionStoryBiblePageId, JOURNALS_ROOT_TITLE);
  }

  private async ensureChildPageByTitle(parentPageId: string, title: string): Promise<string> {
    const existing = await this.findChildPageByTitle(parentPageId, title);
    if (existing) return existing;

    const created = await this.notion.pages.create({
      parent: { page_id: parentPageId },
      properties: {
        title: {
          title: [{ type: "text", text: { content: title } }]
        }
      }
    } as any);

    return created.id;
  }

  private async findChildPageByTitle(parentPageId: string, title: string): Promise<string | undefined> {
    const normalizedTarget = normalizeTitle(title);
    const children = await this.listChildBlocks(parentPageId);
    for (const block of children) {
      if (block.type !== "child_page") continue;
      const childTitle = normalizeTitle(block.child_page?.title ?? "");
      if (childTitle === normalizedTarget) {
        return block.id;
      }
    }
    return undefined;
  }

  private async listChildBlocks(blockId: string): Promise<any[]> {
    const rows: any[] = [];
    let cursor: string | undefined;

    while (true) {
      const response = await this.notion.blocks.children.list({
        block_id: blockId,
        page_size: 100,
        start_cursor: cursor
      });
      rows.push(...response.results);
      if (!response.has_more || !response.next_cursor) break;
      cursor = response.next_cursor;
    }

    return rows;
  }
}

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase();
}

function sanitizePath(segments: string[]): string[] {
  return segments
    .map((x) => String(x ?? "").trim())
    .filter(Boolean);
}

function richTextToPlainText(richText: any[]): string {
  return richText.map((x) => x?.plain_text ?? "").join("");
}

function paragraph(text: string): any {
  return {
    paragraph: {
      rich_text: [
        {
          type: "text",
          text: { content: text.slice(0, 1900) }
        }
      ]
    }
  };
}

function toGeneratedBlocks(payload: {
  metadataLines: string[];
  contentText: string;
  media: Array<{ storedReference: string; sourceUrl: string; checksum: string; sizeBytes: number; foundryAssetId: string }>;
  includeMedia: boolean;
}): any[] {
  const blocks: any[] = [];

  blocks.push({
    toggle: {
      rich_text: [{ type: "text", text: { content: "Sync Metadata (auto)" } }],
      children: toParagraphBlocks(payload.metadataLines)
    }
  });

  blocks.push({
    heading_3: {
      rich_text: [{ type: "text", text: { content: "Journal Content" } }]
    }
  });
  blocks.push(...toParagraphBlocks(payload.contentText.split("\n")));

  if (payload.includeMedia) {
    blocks.push({
      heading_3: {
        rich_text: [{ type: "text", text: { content: "Downloaded Media" } }]
      }
    });
    if (!payload.media.length) {
      blocks.push(paragraph("(No media found)"));
    } else {
      for (const media of payload.media) {
        if (isHttpUrl(media.storedReference) && isLikelyImageUrl(media.storedReference)) {
          blocks.push({
            image: {
              type: "external",
              external: {
                url: media.storedReference
              }
            }
          });
        }

        blocks.push(
          paragraph(
            `Asset ${media.foundryAssetId} | checksum=${media.checksum} | size=${media.sizeBytes} | source=${media.sourceUrl} | stored=${media.storedReference}`
          )
        );
      }
    }
  }

  return blocks;
}

function toParagraphBlocks(lines: string[]): any[] {
  const blocks: any[] = [];
  for (const line of lines) {
    const value = line.trim().length ? line : " ";
    for (const segment of splitForNotion(value)) {
      blocks.push(paragraph(segment));
    }
  }
  return blocks;
}

function splitForNotion(text: string): string[] {
  if (!text) return [" "];
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += NOTION_RICH_TEXT_MAX) {
    parts.push(text.slice(i, i + NOTION_RICH_TEXT_MAX));
  }
  return parts;
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function isLikelyImageUrl(url: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url);
}

function chunkBlocks<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
