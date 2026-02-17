import path from "node:path";
import { config as dotenvConfig } from "dotenv";
import { z } from "zod";

dotenvConfig();

const schema = z.object({
  FOUNDRY_BASE_URL: z.string().url(),
  FOUNDRY_API_TOKEN: z.string().min(1),
  FOUNDRY_BRIDGE_TOKEN: z.string().optional(),
  FOUNDRY_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  FOUNDRY_AUTO_PROXY: z
    .enum(["0", "1", "false", "true", "FALSE", "TRUE"])
    .optional()
    .default("1")
    .transform((value) => value === "1" || value.toLowerCase() === "true"),
  FOUNDRY_AUTO_PROXY_START_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  FOUNDRY_AUTO_PROXY_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(750),

  NOTION_API_KEY: z.string().min(1),
  NOTION_STORY_BIBLE_PAGE_ID: z.string().min(1),
  NOTION_ALLOWED_DATABASE_IDS: z.string().optional().default(""),
  NOTION_DEFAULT_TARGET_DB_ID: z.string().optional(),
  NOTION_TITLE_PROPERTY: z.string().default("Title"),

  BRIDGE_DATA_DIR: z.string().default("./data"),
  BRIDGE_HOST: z.string().default("127.0.0.1"),
  BRIDGE_PORT: z.coerce.number().int().positive().default(8788),
  MEDIA_PUBLIC_BASE_URL: z.string().url().optional(),

  SYNC_RATE_LIMIT_MS: z.coerce.number().int().min(0).default(200),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info")
});

export type AppConfig = {
  foundryBaseUrl: string;
  foundryApiToken: string;
  foundryBridgeToken?: string;
  foundryRequestTimeoutMs: number;
  foundryAutoProxy: boolean;
  foundryAutoProxyStartTimeoutMs: number;
  foundryAutoProxyPollIntervalMs: number;
  notionApiKey: string;
  notionStoryBiblePageId: string;
  notionAllowedDatabaseIds: string[];
  notionDefaultTargetDbId?: string;
  notionTitleProperty: string;
  bridgeDataDir: string;
  bridgeHost: string;
  bridgePort: number;
  mediaPublicBaseUrl?: string;
  syncRateLimitMs: number;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
};

export function loadConfig(): AppConfig {
  const parsed = schema.parse(process.env);

  return {
    foundryBaseUrl: parsed.FOUNDRY_BASE_URL.replace(/\/$/, ""),
    foundryApiToken: parsed.FOUNDRY_API_TOKEN,
    foundryBridgeToken: parsed.FOUNDRY_BRIDGE_TOKEN,
    foundryRequestTimeoutMs: parsed.FOUNDRY_REQUEST_TIMEOUT_MS,
    foundryAutoProxy: parsed.FOUNDRY_AUTO_PROXY,
    foundryAutoProxyStartTimeoutMs: parsed.FOUNDRY_AUTO_PROXY_START_TIMEOUT_MS,
    foundryAutoProxyPollIntervalMs: parsed.FOUNDRY_AUTO_PROXY_POLL_INTERVAL_MS,
    notionApiKey: parsed.NOTION_API_KEY,
    notionStoryBiblePageId: parsed.NOTION_STORY_BIBLE_PAGE_ID,
    notionAllowedDatabaseIds: parsed.NOTION_ALLOWED_DATABASE_IDS.split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    notionDefaultTargetDbId: parsed.NOTION_DEFAULT_TARGET_DB_ID,
    notionTitleProperty: parsed.NOTION_TITLE_PROPERTY,
    bridgeDataDir: path.resolve(parsed.BRIDGE_DATA_DIR),
    bridgeHost: parsed.BRIDGE_HOST,
    bridgePort: parsed.BRIDGE_PORT,
    mediaPublicBaseUrl: parsed.MEDIA_PUBLIC_BASE_URL?.replace(/\/$/, ""),
    syncRateLimitMs: parsed.SYNC_RATE_LIMIT_MS,
    logLevel: parsed.LOG_LEVEL
  };
}
