/**
 * Command-center operational rollup.
 *
 *   GET ?zoneId=… | clusterId=… | settlementId=…   (exactly one)
 *       &month=YYYY-MM                              (optional anchor month)
 *
 * Returns a CommandRollup: one row per programme goal in scope, carrying every
 * pivot key (cluster / settlement / RP / theme) plus the setup, visit-cadence,
 * follow-up and indicator facets. Authorization: `command_center.list` grant +
 * the requested geography must lie in one of the caller's allowed zones.
 */

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { buildRbacContext, can } from "@/lib/rbac";
import {
  loadCommandRollup,
  resolveCommandScope,
  scopeZoneId,
  type CommandScope,
} from "@/lib/operations/command";

export const dynamic = "force-dynamic";

/** Parse "YYYY-MM" to a mid-month Date (local/IST), or null when absent/invalid. */
function parseMonthAnchor(raw: string | null): Date | null {
  if (!raw || !/^\d{4}-\d{2}$/.test(raw)) return null;
  const [y, m] = raw.split("-").map(Number);
  if (m < 1 || m > 12) return null;
  return new Date(y, m - 1, 15);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ctx = await buildRbacContext(session, { req });
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await can(ctx, "command_center", "list"))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const zoneId = url.searchParams.get("zoneId");
  const clusterId = url.searchParams.get("clusterId");
  const settlementId = url.searchParams.get("settlementId");

  let scope: CommandScope | null = null;
  if (zoneId) scope = { kind: "zone", id: zoneId };
  else if (clusterId) scope = { kind: "cluster", id: clusterId };
  else if (settlementId) scope = { kind: "settlement", id: settlementId };
  if (!scope) {
    return Response.json({ error: "Pass exactly one of zoneId / clusterId / settlementId" }, { status: 400 });
  }

  // Geographic authorization before the heavy rollup query.
  const [requestedZone, allowedZones] = await Promise.all([
    scopeZoneId(scope),
    resolveCommandScope(ctx),
  ]);
  if (!requestedZone) return Response.json({ error: "Not found" }, { status: 404 });
  if (!allowedZones.some((z) => z.id === requestedZone)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const anchor = parseMonthAnchor(url.searchParams.get("month"));
  const rollup = await loadCommandRollup(scope, anchor ? { now: anchor } : {});
  if (!rollup) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json(rollup);
}
