import fs from "node:fs";
import path from "node:path";
import http from "node:http";

interface FixtureJournal {
  id: string;
  name: string;
  content: string;
  updatedAt: string;
  aliases?: string[];
  media?: Array<{
    assetId: string;
    sourceUrl: string;
    filename?: string;
    mimeType?: string;
    localPath?: string;
  }>;
}

interface FixtureData {
  journals: FixtureJournal[];
  changes?: Array<{ type: string; id: string; updatedAt: string }>;
}

const host = process.env.MOCK_FOUNDRY_HOST ?? "127.0.0.1";
const port = Number(process.env.MOCK_FOUNDRY_PORT ?? 30000);
const token = process.env.FOUNDRY_API_TOKEN ?? "replace_with_foundry_api_token";
const bridgeToken = process.env.FOUNDRY_BRIDGE_TOKEN;
const fixturePath = path.resolve(process.env.MOCK_FOUNDRY_FIXTURE ?? "./fixtures/foundry-fixture.json");

function unauthorized(res: http.ServerResponse) {
  res.writeHead(401, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "Unauthorized" }));
}

function parseFixture(): FixtureData {
  if (!fs.existsSync(fixturePath)) {
    return { journals: [], changes: [] };
  }
  return JSON.parse(fs.readFileSync(fixturePath, "utf8")) as FixtureData;
}

function matchesAuth(req: http.IncomingMessage): boolean {
  const auth = req.headers.authorization;
  const bridge = req.headers["x-bridge-token"];
  const authOk = auth === `Bearer ${token}`;
  const bridgeOk = bridgeToken ? bridge === bridgeToken : true;
  return authOk && bridgeOk;
}

const server = http.createServer((req, res) => {
  if (!matchesAuth(req)) return unauthorized(res);

  const url = new URL(req.url ?? "/", `http://${host}:${port}`);
  const data = parseFixture();

  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }));
    return;
  }

  if (url.pathname === "/journals") {
    const limit = Number(url.searchParams.get("limit") ?? "200");
    const rows = data.journals.slice(0, limit).map((j) => ({
      id: j.id,
      name: j.name,
      updatedAt: j.updatedAt,
      createdAt: j.updatedAt
    }));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ journals: rows }));
    return;
  }

  const journalMatch = url.pathname.match(/^\/journals\/([^/]+)$/);
  if (journalMatch) {
    const id = decodeURIComponent(journalMatch[1]);
    const journal = data.journals.find((j) => j.id === id);
    if (!journal) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(journal));
    return;
  }

  const mediaMatch = url.pathname.match(/^\/journals\/([^/]+)\/media$/);
  if (mediaMatch) {
    const id = decodeURIComponent(mediaMatch[1]);
    const journal = data.journals.find((j) => j.id === id);
    if (!journal) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ media: journal.media ?? [] }));
    return;
  }

  const assetMatch = url.pathname.match(/^\/assets\/([^/]+)$/);
  if (assetMatch) {
    const id = decodeURIComponent(assetMatch[1]);
    const media = data.journals.flatMap((j) => j.media ?? []).find((m) => m.assetId === id);
    if (!media?.localPath || !fs.existsSync(path.resolve(media.localPath))) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Asset not found" }));
      return;
    }

    const bytes = fs.readFileSync(path.resolve(media.localPath));
    res.writeHead(200, { "content-type": media.mimeType ?? "application/octet-stream" });
    res.end(bytes);
    return;
  }

  if (url.pathname === "/changes") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ changes: data.changes ?? [] }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "Unknown route" }));
});

server.listen(port, host, () => {
  console.log(`Mock Foundry API listening on http://${host}:${port}`);
  console.log(`Fixture file: ${fixturePath}`);
});
