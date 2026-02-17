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

if (!FOUNDRY_SITE_URL) {
  throw new Error("FOUNDRY_SITE_URL is required. Example: http://127.0.0.1:30000");
}
if (!FOUNDRY_SESSION_COOKIE) {
  throw new Error("FOUNDRY_SESSION_COOKIE is required. Use the foundry session cookie value from a logged-in browser.");
}
if (!FOUNDRY_WORLD) {
  throw new Error("FOUNDRY_WORLD is required. Example: music-and-madness-world");
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
});

socket.on("disconnect", (reason) => {
  console.warn(`[foundry-proxy] socket disconnected: ${reason}`);
});

socket.on("connect_error", (error) => {
  console.error(`[foundry-proxy] connect error: ${error.message}`);
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

app.get("/journals", async (_req, res) => {
  try {
    const data = await callModuleAction("list_journals", {});
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

app.listen(PROXY_PORT, PROXY_HOST, () => {
  console.log(`[foundry-proxy] listening on http://${PROXY_HOST}:${PROXY_PORT}`);
  console.log(`[foundry-proxy] forwarding via socket event: ${FOUNDRY_SOCKET_EVENT}`);
});

function buildSocketClient(args: { siteUrl: string; sessionCookie: string; world: string }): Socket {
  const base = args.siteUrl.replace(/\/$/, "");

  const headers: Record<string, string> = {
    Cookie: `session=${args.sessionCookie}`
  };

  return io(base, {
    path: "/socket.io",
    transports: ["websocket", "polling"],
    withCredentials: true,
    extraHeaders: headers,
    query: {
      world: args.world
    },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000
  });
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
    const timeout = setTimeout(() => {
      socket.off(FOUNDRY_SOCKET_EVENT, onMessage);
      reject(new Error(`Timeout waiting for Foundry module response for action '${action}'`));
    }, REQUEST_TIMEOUT_MS);

    const onMessage = (message: any) => {
      if (!message?.__mmBridgeResponse) return;
      if (message?.requestId !== requestId) return;

      clearTimeout(timeout);
      socket.off(FOUNDRY_SOCKET_EVENT, onMessage);
      const response = message?.reply;
      if (!response?.ok) {
        reject(new Error(response?.error ?? "Unknown module error"));
        return;
      }
      resolve(response.data);
    };

    socket.on(FOUNDRY_SOCKET_EVENT, onMessage);
    socket.emit(FOUNDRY_SOCKET_EVENT, requestPayload);
  });
}
