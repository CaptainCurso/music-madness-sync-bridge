import { config as dotenvConfig } from "dotenv";

dotenvConfig();

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
  severity: "error" | "warn";
}

export interface DoctorReport {
  timestamp: string;
  ok: boolean;
  checks: DoctorCheck[];
  summary: {
    errors: number;
    warnings: number;
  };
}

export function runDoctor(): DoctorReport {
  const checks: DoctorCheck[] = [];

  const required = [
    "FOUNDRY_BASE_URL",
    "FOUNDRY_API_TOKEN",
    "FOUNDRY_BRIDGE_TOKEN",
    "FOUNDRY_SITE_URL",
    "FOUNDRY_WORLD",
    "FOUNDRY_SESSION_COOKIE",
    "NOTION_API_KEY",
    "NOTION_STORY_BIBLE_PAGE_ID",
    "NOTION_ALLOWED_DATABASE_IDS",
    "NOTION_DEFAULT_TARGET_DB_ID",
    "NOTION_TITLE_PROPERTY"
  ] as const;

  for (const key of required) {
    const value = process.env[key];
    checks.push({
      name: `required:${key}`,
      ok: Boolean(value && value.trim().length > 0),
      detail: value ? "present" : "missing",
      severity: "error"
    });
  }

  checks.push(validateUrl("FOUNDRY_BASE_URL"));
  checks.push(validateUrl("FOUNDRY_SITE_URL"));

  const dbIds = (process.env.NOTION_ALLOWED_DATABASE_IDS ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  checks.push({
    name: "notion:allowed_db_ids_non_empty",
    ok: dbIds.length > 0,
    detail: dbIds.length > 0 ? `${dbIds.length} ids` : "none provided",
    severity: "error"
  });

  const defaultDb = process.env.NOTION_DEFAULT_TARGET_DB_ID?.trim() ?? "";
  checks.push({
    name: "notion:default_db_in_allowed_list",
    ok: defaultDb.length > 0 && dbIds.includes(defaultDb),
    detail:
      defaultDb.length === 0
        ? "NOTION_DEFAULT_TARGET_DB_ID missing"
        : dbIds.includes(defaultDb)
          ? "ok"
          : "default target db is not in NOTION_ALLOWED_DATABASE_IDS",
    severity: "error"
  });

  const proxyPort = Number(process.env.FOUNDRY_PROXY_PORT ?? "8788");
  checks.push({
    name: "proxy:port_valid",
    ok: Number.isInteger(proxyPort) && proxyPort > 0 && proxyPort <= 65535,
    detail: `FOUNDRY_PROXY_PORT=${proxyPort}`,
    severity: "error"
  });

  const cookie = process.env.FOUNDRY_SESSION_COOKIE ?? "";
  checks.push({
    name: "foundry:session_cookie_shape",
    ok: cookie.length >= 16,
    detail: cookie.length >= 16 ? `length ${cookie.length}` : "too short or missing",
    severity: "warn"
  });

  const world = process.env.FOUNDRY_WORLD ?? "";
  checks.push({
    name: "foundry:world_shape",
    ok: /^[a-zA-Z0-9._-]+$/.test(world),
    detail: world ? "slug-like" : "missing",
    severity: "warn"
  });

  const errors = checks.filter((c) => !c.ok && c.severity === "error").length;
  const warnings = checks.filter((c) => !c.ok && c.severity === "warn").length;

  return {
    timestamp: new Date().toISOString(),
    ok: errors === 0,
    checks,
    summary: {
      errors,
      warnings
    }
  };
}

function validateUrl(envKey: string): DoctorCheck {
  const value = process.env[envKey];
  if (!value) {
    return {
      name: `url:${envKey}`,
      ok: false,
      detail: "missing",
      severity: "error"
    };
  }

  try {
    const parsed = new URL(value);
    const ok = parsed.protocol === "http:" || parsed.protocol === "https:";
    return {
      name: `url:${envKey}`,
      ok,
      detail: ok ? parsed.toString() : `unsupported protocol: ${parsed.protocol}`,
      severity: "error"
    };
  } catch {
    return {
      name: `url:${envKey}`,
      ok: false,
      detail: "invalid url format",
      severity: "error"
    };
  }
}
