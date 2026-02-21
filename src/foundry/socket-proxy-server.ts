import express from "express";
import { io, type Socket } from "socket.io-client";
import "dotenv/config";
import { randomUUID } from "node:crypto";

const PROXY_HOST = process.env.FOUNDRY_PROXY_HOST ?? "127.0.0.1";
const PROXY_PORT = Number(process.env.FOUNDRY_PROXY_PORT ?? 8788);
const REQUEST_TIMEOUT_MS = Number(process.env.FOUNDRY_PROXY_TIMEOUT_MS ?? 15000);

const FOUNDRY_SITE_URL = process.env.FOUNDRY_SITE_URL;
const FOUNDRY_SESSION_COOKIE = process.env.FOUNDRY_SESSION_COOKIE;
const FOUNDRY_WORLD = process.env.FOUNDRY_WORLD;
const FOUNDRY_BRIDGE_TOKEN = process.env.FOUNDRY_BRIDGE_TOKEN;
const FOUNDRY_SOCKET_EVENT = process.env.FOUNDRY_SOCKET_EVENT ?? "module.music-madness-bridge";
const FOUNDRY_SOCKET_NAMESPACE = process.env.FOUNDRY_SOCKET_NAMESPACE ?? "";
const FOUNDRY_SOCKET_TRANSPORTS = (process.env.FOUNDRY_SOCKET_TRANSPORTS ?? "polling,websocket")
  .split(",")
  .map((item) => item.trim())
  .filter((item): item is "polling" | "websocket" => item === "polling" || item === "websocket");
const DEBUG_FOUNDRY_SOCKET = process.env.DEBUG_FOUNDRY_SOCKET === "1";
const FOUNDRY_INCLUDE_WORLD_QUERY = process.env.FOUNDRY_INCLUDE_WORLD_QUERY === "1";
const DEBUG_EVENT_LIMIT = 200;
const debugEvents: Array<{ ts: string; message: string }> = [];

if (!FOUNDRY_SITE_URL) {
  throw new Error("FOUNDRY_SITE_URL is required. Example: http://127.0.0.1:30000");
}
if (!FOUNDRY_SESSION_COOKIE) {
  throw new Error("FOUNDRY_SESSION_COOKIE is required. Use the foundry session cookie value from a logged-in browser.");
}
if (!FOUNDRY_BRIDGE_TOKEN) {
  throw new Error("FOUNDRY_BRIDGE_TOKEN is required and must match the Foundry module world setting.");
}

const app = express();
app.use(express.json());

const socket = buildSocketClient({
  siteUrl: FOUNDRY_SITE_URL,
  sessionCookie: FOUNDRY_SESSION_COOKIE,
  world: FOUNDRY_WORLD
});

socket.on("connect", () => {
  console.log(`[foundry-proxy] socket connected (${socket.id})`);
  pushDebug(`socket connected id=${socket.id}`);
});

socket.on("disconnect", (reason) => {
  console.warn(`[foundry-proxy] socket disconnected: ${reason}`);
  pushDebug(`socket disconnected reason=${reason}`);
});

socket.on("connect_error", (error) => {
  console.error(`[foundry-proxy] connect error: ${error.message}`);
  pushDebug(`socket connect_error message=${error.message}`);
});

socket.onAny((event, ...args) => {
  if (!DEBUG_FOUNDRY_SOCKET) return;
  const preview = safePreview(args[0]);
  console.log(`[foundry-proxy][debug] inbound event=${event} payload=${preview}`);
  pushDebug(`inbound event=${event} payload=${preview}`);
});

app.get("/health", async (_req, res) => {
  try {
    const data = await callModuleAction("health", {});
    res.json({
      status: "ok",
      socketConnected: socket.connected,
      foundry: data
    });
  } catch (error) {
    res.status(502).json({
      status: "error",
      error: String(error)
    });
  }
});

app.get("/journals", async (req, res) => {
  try {
    const payload: Record<string, unknown> = {};
    const folder = typeof req.query.folder === "string" ? req.query.folder.trim() : "";
    const updatedAfter = typeof req.query.updated_after === "string" ? req.query.updated_after.trim() : "";
    const limitRaw = typeof req.query.limit === "string" ? req.query.limit.trim() : "";
    const limit = Number.parseInt(limitRaw, 10);

    if (folder) payload.folder = folder;
    if (updatedAfter) payload.updatedAfter = updatedAfter;
    if (Number.isFinite(limit) && limit > 0) payload.limit = limit;

    const data = await callModuleAction("list_journals", payload);
    res.json({ journals: data.journals ?? [] });
  } catch (error) {
    res.status(502).json({ error: String(error) });
  }
});

app.get("/journals/:id", async (req, res) => {
  try {
    const data = await callModuleAction("get_journal", { journalId: req.params.id });
    res.json(data);
  } catch (error) {
    res.status(502).json({ error: String(error) });
  }
});

app.get("/journals/:id/media", async (req, res) => {
  try {
    const data = await callModuleAction("journal_media", { journalId: req.params.id });
    res.json({ media: data.media ?? [] });
  } catch (error) {
    res.status(502).json({ error: String(error) });
  }
});

app.get("/folders", async (_req, res) => {
  try {
    const data = await callModuleAction("list_folders", {});
    res.json({ folders: data.folders ?? [] });
  } catch (error) {
    res.status(502).json({ error: String(error) });
  }
});

app.get("/assets/:assetId", async (_req, res) => {
  res.status(501).json({
    error:
      "Asset binary passthrough is not implemented in module socket mode. Use sourceUrl from /journals/:id/media or add asset streaming in your Foundry module."
  });
});

app.get("/changes", async (_req, res) => {
  // Stage 1 returns an empty feed unless your module implements change tracking.
  res.json({ changes: [] });
});

app.get("/debug/events", (_req, res) => {
  res.json({
    socketConnected: socket.connected,
    socketId: socket.id ?? null,
    count: debugEvents.length,
    events: debugEvents
  });
});

app.listen(PROXY_PORT, PROXY_HOST, () => {
  console.log(`[foundry-proxy] listening on http://${PROXY_HOST}:${PROXY_PORT}`);
  console.log(`[foundry-proxy] forwarding via socket event: ${FOUNDRY_SOCKET_EVENT}`);
});

function buildSocketClient(args: { siteUrl: string; sessionCookie: string; world?: string }): Socket {
  const base = args.siteUrl.replace(/\/$/, "");
  const namespace = normalizeNamespace(FOUNDRY_SOCKET_NAMESPACE);
  const socketUrl = `${base}${namespace}`;

  const headers: Record<string, string> = {
    Cookie: `session=${args.sessionCookie}`
  };

  const query: Record<string, string> = {
    session: args.sessionCookie
  };
  if (FOUNDRY_INCLUDE_WORLD_QUERY && args.world) {
    query.world = args.world;
  }

  return io(socketUrl, {
    path: "/socket.io",
    transports: FOUNDRY_SOCKET_TRANSPORTS.length ? FOUNDRY_SOCKET_TRANSPORTS : ["polling", "websocket"],
    withCredentials: true,
    extraHeaders: headers,
    query,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000
  });
}

function normalizeNamespace(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

async function callModuleAction(action: string, payload: Record<string, unknown>): Promise<any> {
  if (!socket.connected) {
    throw new Error("Foundry socket is not connected. Verify session cookie/world id and that Foundry is running.");
  }

  const requestId = randomUUID();
  const requestPayload = {
    requestId,
    token: FOUNDRY_BRIDGE_TOKEN,
    action,
    ...payload
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      socket.off(FOUNDRY_SOCKET_EVENT, onMessage);
      socket.off("message", onEnvelopeMessage);
      if (DEBUG_FOUNDRY_SOCKET) {
        console.warn(
          `[foundry-proxy][debug] timeout action=${action} requestId=${requestId} socketConnected=${socket.connected} socketId=${socket.id ?? "none"}`
        );
      }
      pushDebug(
        `timeout action=${action} requestId=${requestId} socketConnected=${socket.connected} socketId=${socket.id ?? "none"}`
      );
      reject(
        new Error(
          `Timeout waiting for Foundry module response for action '${action}'. ` +
            "Socket is connected but no module reply was received. " +
            "Verify module is enabled in the active world, bridge token matches, and at least one browser client is open in that world."
        )
      );
    }, REQUEST_TIMEOUT_MS);

    const finalize = (response: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.off(FOUNDRY_SOCKET_EVENT, onMessage);
      socket.off("message", onEnvelopeMessage);
      if (!response?.ok) {
        reject(new Error(response?.error ?? "Unknown module error"));
        return;
      }
      resolve(response.data);
    };

    const onMessage = (message: any) => {
      if (!message?.__mmBridgeResponse) return;
      if (message?.requestId !== requestId) return;
      finalize(message?.reply);
    };

    const onEnvelopeMessage = (...args: any[]) => {
      // Shape A: object envelope { action|type, data }
      const envelope = args[0];
      const kind = envelope?.action ?? envelope?.type;
      if (envelope && kind === FOUNDRY_SOCKET_EVENT) {
        const message = envelope.data;
        if (message?.__mmBridgeResponse && message?.requestId === requestId) {
          finalize(message?.reply);
          return;
        }
      }

      // Shape B: positional envelope "message", eventName, payload
      const eventName = args[0];
      const payload = args[1];
      if (eventName !== FOUNDRY_SOCKET_EVENT) return;
      if (!payload?.__mmBridgeResponse) return;
      if (payload?.requestId !== requestId) return;
      finalize(payload?.reply);
    };

    socket.on(FOUNDRY_SOCKET_EVENT, onMessage);
    socket.on("message", onEnvelopeMessage);
    if (DEBUG_FOUNDRY_SOCKET) {
      console.log(
        `[foundry-proxy][debug] send action=${action} requestId=${requestId} event=${FOUNDRY_SOCKET_EVENT} world=${FOUNDRY_WORLD}`
      );
    }
    pushDebug(
      `send action=${action} requestId=${requestId} event=${FOUNDRY_SOCKET_EVENT} world=${FOUNDRY_WORLD}`
    );
    // Support both module response styles:
    // - v0.1.0 callback ack style
    // - v0.1.1 explicit socket response envelope
    socket.emit(FOUNDRY_SOCKET_EVENT, requestPayload, (ackResponse: any) => {
      if (ackResponse && typeof ackResponse === "object") {
        finalize(ackResponse);
      }
    });
    // Compatibility with Foundry deployments that route custom socket traffic through
    // the generic "message" event envelope.
    socket.emit("message", { action: FOUNDRY_SOCKET_EVENT, data: requestPayload }, (ackResponse: any) => {
      if (ackResponse && typeof ackResponse === "object") {
        finalize(ackResponse);
      }
    });
    socket.emit("message", { type: FOUNDRY_SOCKET_EVENT, data: requestPayload }, (ackResponse: any) => {
      if (ackResponse && typeof ackResponse === "object") {
        finalize(ackResponse);
      }
    });
    socket.emit("message", FOUNDRY_SOCKET_EVENT, requestPayload, (ackResponse: any) => {
      if (ackResponse && typeof ackResponse === "object") {
        finalize(ackResponse);
      }
    });
  });
}

function safePreview(value: unknown): string {
  try {
    const raw = JSON.stringify(value);
    if (!raw) return "null";
    if (raw.length <= 220) return raw;
    return `${raw.slice(0, 220)}...`;
  } catch {
    return "[unserializable]";
  }
}

function pushDebug(message: string) {
  debugEvents.push({
    ts: new Date().toISOString(),
    message
  });
  if (debugEvents.length > DEBUG_EVENT_LIMIT) {
    debugEvents.splice(0, debugEvents.length - DEBUG_EVENT_LIMIT);
  }
}
