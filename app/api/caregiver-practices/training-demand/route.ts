/**
 * Refresher-training demand: which caregiver practices are weak across creches,
 * so leaders can plan targeted refreshers.
 *
 *   GET ?zoneId=…   (optional; omit = all zones the caller may see)
 *
 * Aggregates the OPEN flags (latest observation per (facility, practice) with
 * status NeedsImprovement / NotPracticed) across creches in scope, grouped by
 * practice. `flaggedCreches` = distinct creches currently carrying that flag.
 * Gated by command_center.list (leader surface).
 */

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { buildRbacContext, can } from "@/lib/rbac";
import { resolveCommandScope } from "@/lib/operations/command";

export const dynamic = "force-dynamic";

type DemandRow = {
  practiceId: string;
  code: string;
  shortLabel: string;
  category: string;
  subcategory: string;
  trainingModule: number | null;
  flaggedCreches: number;
  needsImprovement: number;
  notPracticed: number;
};

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ctx = await buildRbacContext(session, { req });
  if (!ctx || !(await can(ctx, "command_center", "list"))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const allowedZones = await resolveCommandScope(ctx);
  if (allowedZones.length === 0) return Response.json({ zones: [], zoneId: null, practices: [] });
  const requested = new URL(req.url).searchParams.get("zoneId");
  const zoneId = requested && allowedZones.some((z) => z.id === requested) ? requested : null;
  const zoneIds = zoneId ? [zoneId] : allowedZones.map((z) => z.id);

  // Latest observation per (facility, practice) among creche facilities in scope,
  // then keep the open ones and aggregate per practice.
  const rows = await prisma.$queryRaw<DemandRow[]>`
    WITH latest AS (
      SELECT DISTINCT ON (o."facilityId", o."practiceId")
        o."facilityId", o."practiceId", o.status
      FROM "CaregiverPracticeObservation" o
      JOIN "LayerFeature" lf ON lf.id = o."facilityId"
      LEFT JOIN "Cluster" c ON c.id = lf."clusterId"
      WHERE (lf."zoneId" = ANY(${zoneIds}) OR c."zoneId" = ANY(${zoneIds}))
      ORDER BY o."facilityId", o."practiceId", o."capturedAt" DESC, o.id DESC
    )
    SELECT
      pr.id AS "practiceId", pr.code, pr."shortLabel", pr.subcategory, pr."trainingModule",
      cat.name AS category,
      COUNT(*)::int AS "flaggedCreches",
      COUNT(*) FILTER (WHERE l.status = 'NeedsImprovement')::int AS "needsImprovement",
      COUNT(*) FILTER (WHERE l.status = 'NotPracticed')::int AS "notPracticed"
    FROM latest l
    JOIN "CaregiverPractice" pr ON pr.id = l."practiceId"
    JOIN "CaregiverPracticeCategory" cat ON cat.id = pr."categoryId"
    WHERE l.status IN ('NeedsImprovement', 'NotPracticed') AND pr."isActive" = true
    GROUP BY pr.id, pr.code, pr."shortLabel", pr.subcategory, pr."trainingModule", cat.name
    ORDER BY "flaggedCreches" DESC, pr.code
  `;

  return Response.json({
    zones: allowedZones,
    zoneId,
    practices: rows,
  });
}
