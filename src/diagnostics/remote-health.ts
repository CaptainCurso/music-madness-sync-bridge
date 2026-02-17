import { config as dotenvConfig } from "dotenv";

dotenvConfig();

export interface RemoteHealthCheck {
  name: string;
  ok: boolean;
  status?: number;
  detail?: string;
  elapsedMs: number;
  hints?: string[];
}

export interface RemoteHealthReport {
  timestamp: string;
  targetSite: string;
  proxyBase: string;
  checks: RemoteHealthCheck[];
  ok: boolean;
  hints?: string[];
}

export async function runRemoteHealth(verbose = false): Promise<RemoteHealthReport> {
  const site = process.env.FOUNDRY_SITE_URL;
  const proxy = process.env.FOUNDRY_BASE_URL ?? "http://127.0.0.1:8788";

  if (!site) {
    throw new Error("FOUNDRY_SITE_URL is required in .env");
  }

  const checks: RemoteHealthCheck[] = [];

  checks.push(
    await timedCheck("remote_site_http", async () => {
      const response = await fetchWithTimeout(site, 6000);
      const ok = response.ok || [302, 401, 403].includes(response.status);
      return {
        ok,
        status: response.status,
        detail: `HTTP status ${response.status}`,
        hints: ok
          ? []
          : [
              "Remote Foundry URL did not return an expected status.",
              "Confirm FOUNDRY_SITE_URL and that the remote machine is reachable on your LAN."
            ]
      };
    }, (error) => [
      `Cannot reach remote Foundry at ${site}.`,
      "Check remote machine power/network, firewall, and Foundry bind address.",
      "Try opening FOUNDRY_SITE_URL in your browser from this laptop."
    ])
  );

  checks.push(
    await timedCheck("proxy_health", async () => {
      const response = await fetchWithTimeout(`${proxy.replace(/\/$/, "")}/health`, 6000);
      let socketConnected = false;
      let detail = `HTTP status ${response.status}`;
      let hints: string[] = [];

      try {
        const body = (await response.json()) as any;
        socketConnected = Boolean(body?.socketConnected);
        detail = socketConnected
          ? "Proxy reachable and socket connected"
          : `Proxy reachable but socket not connected (${JSON.stringify(body)})`;

        if (!socketConnected) {
          hints = [
            "Proxy is running but could not connect to Foundry socket.",
            "Check FOUNDRY_SESSION_COOKIE, FOUNDRY_WORLD, FOUNDRY_SITE_URL, and module enablement.",
            "Verify module bridge token in Foundry world settings matches FOUNDRY_BRIDGE_TOKEN."
          ];
        }
      } catch {
        hints = [
          "Proxy /health returned non-JSON or unexpected payload.",
          "Check proxy logs for runtime errors."
        ];
      }

      return {
        ok: response.ok && socketConnected,
        status: response.status,
        detail,
        hints
      };
    }, (_error) => [
      `Cannot reach local proxy at ${proxy}.`,
      "Start proxy with: npm run foundry:proxy",
      "Confirm FOUNDRY_BASE_URL matches proxy host/port."
    ])
  );

  checks.push(
    await timedCheck("proxy_journals", async () => {
      const response = await fetchWithTimeout(`${proxy.replace(/\/$/, "")}/journals`, 6000);
      let detail = `HTTP status ${response.status}`;
      let hints: string[] = [];

      try {
        const body = (await response.json()) as any;
        const count = Array.isArray(body?.journals) ? body.journals.length : 0;
        detail = `HTTP ${response.status}, journals=${count}`;

        if (!response.ok) {
          hints = inferProxyAuthHints(response.status);
        }

        return {
          ok: response.ok,
          status: response.status,
          detail,
          hints
        };
      } catch {
        return {
          ok: response.ok,
          status: response.status,
          detail,
          hints: response.ok
            ? ["Unexpected response shape from /journals route."]
            : inferProxyAuthHints(response.status)
        };
      }
    }, (_error) => [
      "Proxy /journals failed. This usually means proxy is down or socket/auth to Foundry is failing.",
      "Check proxy terminal logs for module errors and auth failures."
    ])
  );

  const aggregateHints = checks.flatMap((c) => c.hints ?? []);

  return {
    timestamp: new Date().toISOString(),
    targetSite: site,
    proxyBase: proxy,
    checks: checks.map((c) => (verbose ? c : stripVerbose(c))),
    ok: checks.every((c) => c.ok),
    ...(verbose ? { hints: dedupe(aggregateHints) } : {})
  };
}

async function timedCheck(
  name: string,
  fn: () => Promise<{ ok: boolean; status?: number; detail?: string; hints?: string[] }>,
  onErrorHints: (error: unknown) => string[]
): Promise<RemoteHealthCheck> {
  const started = Date.now();
  try {
    const result = await fn();
    return {
      name,
      ok: result.ok,
      status: result.status,
      detail: result.detail,
      elapsedMs: Date.now() - started,
      hints: result.hints ?? []
    };
  } catch (error) {
    return {
      name,
      ok: false,
      detail: String(error),
      elapsedMs: Date.now() - started,
      hints: onErrorHints(error)
    };
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

function inferProxyAuthHints(status?: number): string[] {
  if (status === 401 || status === 403) {
    return [
      "Proxy reached Foundry but was unauthorized.",
      "Refresh FOUNDRY_SESSION_COOKIE from a currently logged-in Foundry browser session.",
      "Verify FOUNDRY_BRIDGE_TOKEN matches module world setting.",
      "Confirm FOUNDRY_WORLD points to the active world slug/id."
    ];
  }

  if (status === 404) {
    return [
      "Route not found from proxy target.",
      "Confirm proxy is running the latest code and module socket event name is correct."
    ];
  }

  if (status && status >= 500) {
    return [
      "Foundry/proxy returned server error.",
      "Inspect proxy logs and Foundry console for stack traces."
    ];
  }

  return ["Unexpected proxy response. Check proxy and Foundry logs."];
}

function stripVerbose(check: RemoteHealthCheck): RemoteHealthCheck {
  const { hints: _hints, ...rest } = check;
  return rest;
}

function dedupe(lines: string[]): string[] {
  return [...new Set(lines.filter(Boolean))];
}
