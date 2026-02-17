import pino from "pino";
import type { AppConfig } from "./config.js";

export function createLogger(config: AppConfig) {
  return pino({
    level: config.logLevel,
    base: { service: "music-madness-sync-bridge" }
  });
}
