// MIS provider sync. Reads provider config, walks indicators bound to this provider,
// fetches each indicator's data using its misFetchConfig, and writes
// FacilityIndicator + FacilityIndicatorPoint rows.
//
// Fetch config shape (per indicator) — provider-specific but Frappe-shaped by default:
// {
//   "endpoint": "/api/method/path",          // appended to provider.baseUrl
//   "valuePath": "message.enrollment_pct",   // dot-path into JSON response (object or per-row array)
//   "settlementCodePath": "message.slum_code",
//   "rowsPath": "message",                    // optional — if response is { message: [ ...rows ] }
//   "filters": { "active": 1 }                // optional query params
// }
//
// Settlement code mapping lives on MISProviderConfig.notes JSON for v1 — TODO move to dedicated table.

import prisma from "@/lib/prisma";

type SyncResult = {
  ok: boolean;
  message: string;
  pointsWritten: number;
  errors: string[];
  indicators: { key: string; pointsWritten: number; error?: string }[];
};

type ProviderRow = {
  id: string;
  key: string;
  label: string;
  baseUrl: string;
  authType: string;
  credentials: Record<string, string> | null;
  notes: string | null;
};

type IndicatorDefRow = {
  id: string;
  key: string;
  label: string;
  misFetchConfig: Record<string, unknown> | null;
};

function getByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  return path.split(".").reduce<unknown>((acc, k) => {
    if (acc == null) return undefined;
    if (typeof acc === "object" && !Array.isArray(acc)) {
      return (acc as Record<string, unknown>)[k];
    }
    return undefined;
  }, obj);
}

function buildAuthHeaders(provider: ProviderRow): HeadersInit {
  const c = provider.credentials ?? {};
  if (provider.authType === "frappe" && c.apiKey && c.apiSecret) {
    return { Authorization: `token ${c.apiKey}:${c.apiSecret}` };
  }
  if (provider.authType === "bearer" && c.token) {
    return { Authorization: `Bearer ${c.token}` };
  }
  if (provider.authType === "basic" && c.user && c.pass) {
    const b64 = Buffer.from(`${c.user}:${c.pass}`).toString("base64");
    return { Authorization: `Basic ${b64}` };
  }
  if (provider.authType === "api_key" && c.apiKey) {
    return { Authorization: c.apiKey };
  }
  return {};
}

// Settlement-code → settlementId map. Comes from provider.notes JSON (parsed).
// Notes is free-text; we look for a JSON block tagged "settlementMap" or fall back
// to settlement name-matching.
async function resolveSettlementMap(provider: ProviderRow): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (provider.notes) {
    try {
      const parsed = JSON.parse(provider.notes);
      if (parsed && typeof parsed === "object" && parsed.settlementMap && typeof parsed.settlementMap === "object") {
        for (const [code, sid] of Object.entries(parsed.settlementMap as Record<string, string>)) {
          map.set(String(code), String(sid));
        }
      }
    } catch {
      // notes wasn't JSON — fall through to name match
    }
  }
  // Fallback: build name → id lookup for case-insensitive matching
  if (map.size === 0) {
    const settlements = await prisma.settlement.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
    });
    for (const s of settlements) map.set(s.name.toLowerCase().trim(), s.id);
  }
  return map;
}

export async function runMisSync(providerId: string): Promise<SyncResult> {
  const providers = await prisma.$queryRaw<ProviderRow[]>`
    SELECT id, key, label, "baseUrl", "authType", credentials, notes
    FROM "MISProviderConfig"
    WHERE id = ${providerId}
  `;
  const provider = providers[0];
  if (!provider) return { ok: false, message: "Provider not found", pointsWritten: 0, errors: [], indicators: [] };
  if (!provider.credentials) {
    return { ok: false, message: "Provider has no credentials configured", pointsWritten: 0, errors: [], indicators: [] };
  }

  // Open sync log row
  const log = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO "MISProviderSyncLog" (id, "providerId", "startedAt", status, "pointsWritten")
    VALUES (gen_random_uuid()::text, ${providerId}, NOW(), 'running', 0)
    RETURNING id
  `;
  const logId = log[0].id;

  const defs = await prisma.$queryRaw<IndicatorDefRow[]>`
    SELECT id, key, label, "misFetchConfig"
    FROM "FacilityIndicatorDef"
    WHERE "isActive" = true AND "misProviderId" = ${providerId} AND "captureSource"::text = 'MIS_API'
  `;

  if (defs.length === 0) {
    await prisma.$executeRaw`
      UPDATE "MISProviderSyncLog" SET status = 'ok', "finishedAt" = NOW(), message = 'No indicators bound to this provider'
      WHERE id = ${logId}
    `;
    await prisma.$executeRaw`UPDATE "MISProviderConfig" SET "lastSyncedAt" = NOW(), "lastSyncStatus" = 'ok', "updatedAt" = NOW() WHERE id = ${providerId}`;
    return { ok: true, message: "No indicators bound", pointsWritten: 0, errors: [], indicators: [] };
  }

  const settlementMap = await resolveSettlementMap(provider);
  const auth = buildAuthHeaders(provider);
  const now = new Date();
  let totalPoints = 0;
  const errors: string[] = [];
  const indicatorsReport: { key: string; pointsWritten: number; error?: string }[] = [];

  for (const def of defs) {
    const cfg = (def.misFetchConfig ?? {}) as Record<string, unknown>;
    const endpoint = String(cfg.endpoint ?? "");
    if (!endpoint) {
      const msg = `${def.key}: no endpoint in fetch config`;
      errors.push(msg);
      indicatorsReport.push({ key: def.key, pointsWritten: 0, error: msg });
      continue;
    }
    const valuePath = String(cfg.valuePath ?? "value");
    const settlementCodePath = String(cfg.settlementCodePath ?? "slum_code");
    const rowsPath = cfg.rowsPath ? String(cfg.rowsPath) : "message";
    const filters = cfg.filters && typeof cfg.filters === "object" ? cfg.filters as Record<string, string> : {};

    const url = new URL(endpoint, provider.baseUrl);
    for (const [k, v] of Object.entries(filters)) url.searchParams.set(k, String(v));

    let pointsForDef = 0;
    try {
      const res = await fetch(url.toString(), { headers: auth });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const json = await res.json();
      const rowsRaw = rowsPath ? getByPath(json, rowsPath) : json;
      const rows = Array.isArray(rowsRaw) ? rowsRaw : [rowsRaw];

      for (const row of rows) {
        const code = getByPath(row, settlementCodePath);
        const value = getByPath(row, valuePath);
        if (code == null || value == null) continue;
        const codeKey = String(code).toLowerCase().trim();
        const sid = settlementMap.get(String(code)) ?? settlementMap.get(codeKey);
        if (!sid) continue;
        const numValue = Number(value);
        if (!Number.isFinite(numValue)) continue;

        // Upsert FacilityIndicator, then insert point. MIS feeds are
        // settlement-wide aggregates with no facility identity, so they own the
        // settlement-level (facilityId IS NULL) row — never a per-facility one.
        const existing = await prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM "FacilityIndicator"
          WHERE "defId" = ${def.id} AND "settlementId" = ${sid} AND "facilityId" IS NULL
        `;
        let indicatorId: string;
        if (existing[0]) {
          indicatorId = existing[0].id;
          await prisma.$executeRaw`
            UPDATE "FacilityIndicator"
            SET "currentValue" = ${numValue}, "lastCapturedAt" = ${now}, "lastSource" = 'MIS_API',
                "updatedAt" = NOW()
            WHERE id = ${indicatorId}
          `;
        } else {
          const insertRows = await prisma.$queryRaw<{ id: string }[]>`
            INSERT INTO "FacilityIndicator" (id, "defId", "settlementId", "currentValue", "lastCapturedAt", "lastSource", "createdAt", "updatedAt")
            VALUES (gen_random_uuid()::text, ${def.id}, ${sid}, ${numValue}, ${now}, 'MIS_API', NOW(), NOW())
            RETURNING id
          `;
          indicatorId = insertRows[0].id;
        }
        await prisma.$executeRaw`
          INSERT INTO "FacilityIndicatorPoint" (id, "indicatorId", value, "capturedAt", source, "sourceRefId")
          VALUES (gen_random_uuid()::text, ${indicatorId}, ${numValue}, ${now}, 'MIS_API', ${logId})
        `;
        pointsForDef += 1;
      }
      totalPoints += pointsForDef;
      indicatorsReport.push({ key: def.key, pointsWritten: pointsForDef });
    } catch (e) {
      const msg = `${def.key}: ${e instanceof Error ? e.message : String(e)}`;
      errors.push(msg);
      indicatorsReport.push({ key: def.key, pointsWritten: pointsForDef, error: msg });
    }
  }

  const status = errors.length === 0 ? "ok" : (totalPoints > 0 ? "ok" : "error");
  const summary = `Wrote ${totalPoints} points across ${defs.length} indicator${defs.length === 1 ? "" : "s"}${errors.length ? `; ${errors.length} error${errors.length === 1 ? "" : "s"}` : ""}`;

  await prisma.$executeRaw`
    UPDATE "MISProviderSyncLog"
    SET status = ${status}, "finishedAt" = NOW(), "pointsWritten" = ${totalPoints},
        message = ${summary}, details = ${JSON.stringify({ indicators: indicatorsReport, errors })}::jsonb
    WHERE id = ${logId}
  `;
  await prisma.$executeRaw`
    UPDATE "MISProviderConfig"
    SET "lastSyncedAt" = NOW(), "lastSyncStatus" = ${status === "ok" ? "ok" : `error: ${errors[0] ?? "unknown"}`}, "updatedAt" = NOW()
    WHERE id = ${providerId}
  `;

  return {
    ok: status === "ok",
    message: summary,
    pointsWritten: totalPoints,
    errors,
    indicators: indicatorsReport,
  };
}
