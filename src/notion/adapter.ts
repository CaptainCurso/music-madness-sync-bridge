import { Client } from "@notionhq/client";
import type { AppConfig } from "../config.js";

export class NotionAdapter {
  private readonly notion: Client;

  constructor(private readonly config: AppConfig) {
    this.notion = new Client({ auth: config.notionApiKey });
  }

  async findPageByCanonicalOrAlias(canonicalName: string, aliases: string[]): Promise<string | undefined> {
    const terms = [canonicalName, ...aliases].map((x) => x.trim()).filter(Boolean);
    for (const term of terms) {
      const response = await this.notion.search({
        query: term,
        filter: { value: "page", property: "object" },
        page_size: 50
      });

      for (const result of response.results) {
        if (result.object !== "page") continue;
        const page = result as any;
        const parentDbId = page.parent?.database_id as string | undefined;
        if (!parentDbId || !this.config.notionAllowedDatabaseIds.includes(parentDbId)) continue;

        const title = extractPageTitle(page).toLowerCase();
        const aliasValues = extractAliases(page).map((x) => x.toLowerCase());

        const normalizedCanonical = canonicalName.toLowerCase();
        const normalizedAliases = aliases.map((x) => x.toLowerCase());

        if (
          title === normalizedCanonical ||
          aliasValues.includes(normalizedCanonical) ||
          normalizedAliases.some((a) => title === a || aliasValues.includes(a))
        ) {
          return page.id;
        }
      }
    }

    return undefined;
  }

  async createStoryBiblePage(canonicalName: string, typeLabel = "Foundry Journal"): Promise<string> {
    if (!this.config.notionDefaultTargetDbId) {
      throw new Error(
        "NOTION_DEFAULT_TARGET_DB_ID is required to create new pages when no canonical page match is found."
      );
    }

    if (!this.config.notionAllowedDatabaseIds.includes(this.config.notionDefaultTargetDbId)) {
      throw new Error("NOTION_DEFAULT_TARGET_DB_ID must be included in NOTION_ALLOWED_DATABASE_IDS.");
    }

    const page = await this.notion.pages.create({
      parent: { database_id: this.config.notionDefaultTargetDbId },
      properties: {
        [this.config.notionTitleProperty]: {
          title: [{ type: "text", text: { content: canonicalName } }]
        }
      }
    } as any);

    await this.notion.blocks.children.append({
      block_id: page.id,
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

    return page.id;
  }

  async getPageLastEdited(pageId: string): Promise<string> {
    const page = (await this.notion.pages.retrieve({ page_id: pageId })) as any;
    return String(page.last_edited_time ?? new Date(0).toISOString());
  }

  async upsertFoundryMirror(
    pageId: string,
    mirrorLines: string[],
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

    const generatedBlocks = toGeneratedBlocks(mirrorLines);

    const response = await this.notion.blocks.children.append({
      block_id: pageId,
      children: [
        {
          toggle: {
            rich_text: [
              {
                type: "text",
                text: {
                  content: `Generated mirror content (auto) - ${new Date().toISOString()}`
                }
              }
            ],
            children: generatedBlocks
          }
        }
      ] as any
    });

    const first = response.results[0] as any;
    return { mirrorBlockId: first.id };
  }
}

function extractPageTitle(page: any): string {
  const properties = page.properties ?? {};
  for (const value of Object.values(properties)) {
    const prop = value as any;
    if (prop?.type === "title") {
      return richTextToPlainText(prop.title ?? []);
    }
  }
  return "";
}

function extractAliases(page: any): string[] {
  const properties = page.properties ?? {};
  const aliases: string[] = [];

  const byName = properties["Aliases"] as any;
  if (byName) {
    if (byName.type === "rich_text") {
      aliases.push(...richTextToPlainText(byName.rich_text ?? []).split(/[;,]/).map((x: string) => x.trim()));
    }
    if (byName.type === "multi_select") {
      aliases.push(...(byName.multi_select ?? []).map((x: any) => String(x.name)));
    }
  }

  return aliases.filter(Boolean);
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

function toGeneratedBlocks(lines: string[]): any[] {
  const blocks: any[] = [];
  for (const line of lines) {
    const safe = line.length > 1900 ? `${line.slice(0, 1896)}...` : line;
    blocks.push(paragraph(safe));
    if (blocks.length >= 90) {
      blocks.push(paragraph("[Truncated at 90 generated lines to keep Notion updates safe.]"));
      break;
    }
  }
  return blocks;
}
