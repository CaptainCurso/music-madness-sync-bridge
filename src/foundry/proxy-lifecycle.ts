import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "../config.js";
import { sleep } from "../utils/sleep.js";

type ProxyHealthState = "healthy" | "unhealthy" | "unreachable";

export interface ProxyLifecycleHandle {
  startedByThisCommand: boolean;
  stop: () => Promise<void>;
}

export async function ensureProxyForSync(
  config: AppConfig,
  opts?: { label?: string }
): Promise<ProxyLifecycleHandle> {
  const label = opts?.label ?? "sync";
  if (!config.foundryAutoProxy) {
    return noopHandle();
  }

  if (!isLocalProxyBaseUrl(config.foundryBaseUrl)) {
    return noopHandle();
  }

  const healthUrl = toHealthUrl(config.foundryBaseUrl);
  const initialProbe = await probeProxyHealth(healthUrl, 3000);

  if (initialProbe.state === "healthy") {
    return noopHandle();
  }

  if (initialProbe.state === "unhealthy") {
    throw new Error(
      [
        `Foundry proxy is reachable but unhealthy at ${healthUrl}.`,
        `Details: ${initialProbe.detail}`,
        "Not auto-restarting because this proxy was not started by this command.",
        "Run `npm run foundry:proxy` in a terminal and verify FOUNDRY_SESSION_COOKIE, FOUNDRY_BRIDGE_TOKEN, and FOUNDRY_WORLD."
      ].join(" ")
    );
  }

  console.error(`[auto-proxy] Starting local Foundry proxy for ${label}...`);
  const child = startProxyChildProcess();
  const stop = createOwnedStopper(child, label);

  const startedAt = Date.now();
  let lastDetail = initialProbe.detail;

  while (Date.now() - startedAt < config.foundryAutoProxyStartTimeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) {
      await stop();
      throw new Error(
        `Auto-started Foundry proxy exited before becoming ready (exitCode=${child.exitCode}, signal=${child.signalCode ?? "none"}).`
      );
    }

    const probe = await probeProxyHealth(healthUrl, 3000);
    lastDetail = probe.detail;
    if (probe.state === "healthy") {
      return {
        startedByThisCommand: true,
        stop
      };
    }

    await sleep(config.foundryAutoProxyPollIntervalMs);
  }

  await stop();
  throw new Error(
    [
      `Timed out waiting for auto-started Foundry proxy to become healthy within ${config.foundryAutoProxyStartTimeoutMs}ms.`,
      `Last health detail: ${lastDetail}`,
      "Verify Foundry is running and module token/world/session settings are valid."
    ].join(" ")
  );
}

export function isLocalProxyBaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

function toHealthUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  return `${trimmed}/health`;
}

async function probeProxyHealth(
  healthUrl: string,
  timeoutMs: number
): Promise<{ state: ProxyHealthState; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(healthUrl, {
      method: "GET",
      signal: controller.signal
    });

    const rawText = await response.text();
    let json: any;

    try {
      json = rawText ? JSON.parse(rawText) : null;
    } catch {
      json = null;
    }

    const isHealthy =
      response.ok &&
      json &&
      typeof json === "object" &&
      json.status === "ok" &&
      json.socketConnected === true;

    if (isHealthy) {
      return {
        state: "healthy",
        detail: "Proxy reachable and socket connected."
      };
    }

    const detail =
      json && typeof json === "object"
        ? JSON.stringify(json)
        : `HTTP ${response.status}: ${rawText.slice(0, 240) || "no response body"}`;

    return { state: "unhealthy", detail };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { state: "unreachable", detail: message };
  } finally {
    clearTimeout(timer);
  }
}

function startProxyChildProcess(): ChildProcess {
  const proxyEntrypoint = fileURLToPath(new URL("./socket-proxy-server.js", import.meta.url));

  return spawn(process.execPath, [proxyEntrypoint], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "ignore"
  });
}

function createOwnedStopper(child: ChildProcess, label: string): () => Promise<void> {
  let stopped = false;

  const onSigint = () => {
    void stopOwnedProxy().finally(() => {
      process.exit(130);
    });
  };

  const onSigterm = () => {
    void stopOwnedProxy().finally(() => {
      process.exit(143);
    });
  };

  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  return stopOwnedProxy;

  async function stopOwnedProxy(): Promise<void> {
    if (stopped) return;
    stopped = true;

    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);

    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const exitedAfterTerm = await waitForExit(child, 5000);
      if (!exitedAfterTerm && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await waitForExit(child, 2000);
      }
    }

    console.error(`[auto-proxy] Stopped auto-started local Foundry proxy for ${label}.`);
  }
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    let done = false;

    const onExit = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(true);
    };

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);

    child.once("exit", onExit);
  });
}

function noopHandle(): ProxyLifecycleHandle {
  return {
    startedByThisCommand: false,
    stop: async () => {}
  };
}
