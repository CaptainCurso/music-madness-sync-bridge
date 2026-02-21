const MODULE_ID = "music-madness-bridge";
const SOCKET_EVENT = `module.${MODULE_ID}`;
const DEBUG_PREFIX = "[MMBridgeDebug]";

function debugLog(message, data) {
  if (data !== undefined) {
    console.log(`${DEBUG_PREFIX} ${message}`, data);
    return;
  }
  console.log(`${DEBUG_PREFIX} ${message}`);
}

Hooks.once("init", () => {
  debugLog("init hook fired");
  game.settings.register(MODULE_ID, "bridgeToken", {
    name: "MMBridge.Settings.BridgeToken.Name",
    hint: "MMBridge.Settings.BridgeToken.Hint",
    scope: "world",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, "readEnabled", {
    name: "MMBridge.Settings.ReadEnabled.Name",
    hint: "MMBridge.Settings.ReadEnabled.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.modules.get(MODULE_ID).api = {
    socketEvent: SOCKET_EVENT,
    version: "0.1.7"
  };
  debugLog("module API registered", game.modules.get(MODULE_ID).api);
});

Hooks.once("ready", () => {
  debugLog("ready hook fired", {
    worldId: game.world?.id ?? null,
    userId: game.user?.id ?? null,
    isGM: Boolean(game.user?.isGM)
  });
  const onPayload = async (payload, respond) => {
    if (payload?.__mmBridgeResponse) return;
    debugLog("onPayload received", {
      action: payload?.action ?? null,
      requestId: payload?.requestId ?? null,
      hasToken: Boolean(payload?.token),
      hasRespondCallback: typeof respond === "function"
    });
    const reply = await handle(payload);
    debugLog("onPayload reply", {
      requestId: payload?.requestId ?? null,
      ok: reply?.ok ?? null,
      error: reply?.error ?? null
    });
    if (typeof respond === "function") {
      respond(reply);
    }
    game.socket.emit(SOCKET_EVENT, {
      __mmBridgeResponse: true,
      requestId: payload?.requestId ?? null,
      reply
    });
    game.socket.emit("message", {
      action: SOCKET_EVENT,
      data: {
        __mmBridgeResponse: true,
        requestId: payload?.requestId ?? null,
        reply
      }
    });
    game.socket.emit("message", SOCKET_EVENT, {
      __mmBridgeResponse: true,
      requestId: payload?.requestId ?? null,
      reply
    });
  };

  game.socket.on(SOCKET_EVENT, onPayload);
  debugLog("socket listener attached", { event: SOCKET_EVENT });
  game.socket.on("message", async (...args) => {
    // Shape A: object envelope { action|type, data }, optional respond callback.
    const envelope = args[0];
    const respond = typeof args[1] === "function" ? args[1] : undefined;
    const kind = envelope?.action ?? envelope?.type;
    debugLog("message event observed", {
      shape: envelope && typeof envelope === "object" ? "object" : "positional_or_other",
      kind: kind ?? null,
      argCount: args.length
    });
    if (envelope && kind === SOCKET_EVENT) {
      await onPayload(envelope.data, respond);
      return;
    }

    // Shape B: positional envelope "message", eventName, payload, optional respond callback.
    const eventName = args[0];
    const payload = args[1];
    const positionalRespond = typeof args[2] === "function" ? args[2] : undefined;
    if (eventName !== SOCKET_EVENT) return;
    await onPayload(payload, positionalRespond);
  });
});

async function handle(payload) {
  try {
    debugLog("handle entered", {
      action: payload?.action ?? null,
      requestId: payload?.requestId ?? null
    });
    if (!game.settings.get(MODULE_ID, "readEnabled")) {
      debugLog("read bridge disabled");
      return { ok: false, error: "Read bridge is disabled." };
    }

    const token = game.settings.get(MODULE_ID, "bridgeToken");
    if (!token || payload?.token !== token) {
      debugLog("token mismatch", {
        hasConfiguredToken: Boolean(token),
        providedTokenLength: payload?.token ? String(payload.token).length : 0,
        configuredTokenLength: token ? String(token).length : 0
      });
      return { ok: false, error: "Unauthorized" };
    }

    const action = payload?.action;

    if (action === "health") {
      return {
        ok: true,
        data: {
          system: game.system.id,
          world: game.world.id,
          user: game.user?.id,
          timestamp: new Date().toISOString()
        }
      };
    }

    if (action === "list_journals") {
      const rows = game.journal.contents.map((j) => ({
        id: j.id,
        name: j.name,
        folderId: j.folder?.id ?? null,
        folderPath: folderPathSegments(j.folder),
        createdAt: j._source?.createdTime ?? null,
        updatedAt: j._source?.sort ?? null
      }));
      return { ok: true, data: { journals: rows } };
    }

    if (action === "list_folders") {
      const folders = game.folders.contents
        .filter((f) => f.type === "JournalEntry")
        .map((f) => ({
          id: f.id,
          name: f.name,
          parentId: f.folder?.id ?? null,
          path: folderPathSegments(f)
        }));

      return { ok: true, data: { folders } };
    }

    if (action === "get_journal") {
      const journal = game.journal.get(payload?.journalId);
      if (!journal) return { ok: false, error: "Journal not found" };

      const pages = journal.pages.contents ?? [];
      const content = pages
        .map((p) => {
          const html = pageHtmlContent(p);
          return `<h3>${p.name}</h3>${html}`;
        })
        .join("\n\n");
      const media = collectJournalMedia(journal);

      return {
        ok: true,
        data: {
          id: journal.id,
          name: journal.name,
          folderId: journal.folder?.id ?? null,
          folderPath: folderPathSegments(journal.folder),
          content,
          media,
          aliases: [],
          updatedAt: new Date().toISOString()
        }
      };
    }

    if (action === "journal_media") {
      const journal = game.journal.get(payload?.journalId);
      if (!journal) return { ok: false, error: "Journal not found" };
      return { ok: true, data: { media: collectJournalMedia(journal) } };
    }

    return { ok: false, error: `Unknown action: ${action}` };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

function folderPathSegments(folder) {
  const path = [];
  let current = folder ?? null;
  while (current) {
    if (current.name) path.unshift(String(current.name));
    current = current.folder ?? null;
  }
  return path;
}

function pageHtmlContent(page) {
  const textHtml = page?.text?.content;
  if (textHtml && String(textHtml).trim()) return String(textHtml);

  const imageSrc = pageImageSource(page);
  if (imageSrc) {
    const safeName = page?.name ? String(page.name) : "Image";
    return `<p>${safeName}</p><img src="${imageSrc}" alt="${safeName}">`;
  }

  return "";
}

function pageImageSource(page) {
  const candidates = [
    page?.src,
    page?.image?.src,
    page?._source?.src,
    page?._source?.image?.src
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const value = String(candidate).trim();
    if (value) return value;
  }
  return null;
}

function collectJournalMedia(journal) {
  const urls = new Set();

  const journalImage = journal?.img ? String(journal.img).trim() : "";
  if (journalImage) urls.add(journalImage);

  const pages = journal?.pages?.contents ?? [];
  const regex = /(?:src|href)=["']([^"']+)["']/gi;

  for (const page of pages) {
    const directImage = pageImageSource(page);
    if (directImage) urls.add(directImage);

    const html = pageHtmlContent(page);
    let match;
    while ((match = regex.exec(html)) !== null) {
      if (!match[1]) continue;
      const sourceUrl = String(match[1]).trim();
      if (sourceUrl) urls.add(sourceUrl);
    }
  }

  return [...urls].map((sourceUrl) => ({ sourceUrl }));
}
