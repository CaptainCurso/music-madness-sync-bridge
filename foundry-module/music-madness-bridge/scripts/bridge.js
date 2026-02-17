const MODULE_ID = "music-madness-bridge";
const SOCKET_EVENT = `module.${MODULE_ID}`;

Hooks.once("init", () => {
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
    version: "0.1.1"
  };
});

Hooks.once("ready", () => {
  game.socket.on(SOCKET_EVENT, async (payload) => {
    if (payload?.__mmBridgeResponse) return;
    const reply = await handle(payload);
    game.socket.emit(SOCKET_EVENT, {
      __mmBridgeResponse: true,
      requestId: payload?.requestId ?? null,
      reply
    });
  });
});

async function handle(payload) {
  try {
    if (!game.settings.get(MODULE_ID, "readEnabled")) {
      return { ok: false, error: "Read bridge is disabled." };
    }

    const token = game.settings.get(MODULE_ID, "bridgeToken");
    if (!token || payload?.token !== token) {
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
        createdAt: j._source?.createdTime ?? null,
        updatedAt: j._source?.sort ?? null
      }));
      return { ok: true, data: { journals: rows } };
    }

    if (action === "get_journal") {
      const journal = game.journal.get(payload?.journalId);
      if (!journal) return { ok: false, error: "Journal not found" };

      const pages = journal.pages.contents ?? [];
      const content = pages
        .map((p) => {
          const html = p.text?.content ?? "";
          return `<h3>${p.name}</h3>${html}`;
        })
        .join("\n\n");

      return {
        ok: true,
        data: {
          id: journal.id,
          name: journal.name,
          content,
          aliases: [],
          updatedAt: new Date().toISOString()
        }
      };
    }

    if (action === "journal_media") {
      const journal = game.journal.get(payload?.journalId);
      if (!journal) return { ok: false, error: "Journal not found" };

      const pages = journal.pages.contents ?? [];
      const media = [];
      const regex = /(?:src|href)=["']([^"']+)["']/gi;

      for (const page of pages) {
        const html = page.text?.content ?? "";
        let match;
        while ((match = regex.exec(html)) !== null) {
          if (!match[1]) continue;
          media.push({ sourceUrl: match[1] });
        }
      }

      return { ok: true, data: { media } };
    }

    return { ok: false, error: `Unknown action: ${action}` };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}
