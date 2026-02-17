import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import { FoundryClient } from "./foundry/client.js";
import { createLogger } from "./logger.js";
import { NotionAdapter } from "./notion/adapter.js";
import { StateStore } from "./state/store.js";
import { SyncService } from "./sync/service.js";

export async function createAppContext() {
  const config = loadConfig();
  fs.mkdirSync(config.bridgeDataDir, { recursive: true });

  const logger = createLogger(config);
  const state = await StateStore.create(config.bridgeDataDir);
  const foundry = new FoundryClient(config);
  const notion = new NotionAdapter(config);
  const sync = new SyncService(config, logger, state, foundry, notion);

  return {
    config,
    logger,
    state,
    foundry,
    notion,
    sync,
    paths: {
      root: path.resolve("."),
      data: config.bridgeDataDir
    }
  };
}
