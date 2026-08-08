/**
 * Caregiver-practice capture for a creche visit.
 *
 *   GET  ?visitEventId=…  → { facilityLinked, categories[…drill…], openFlags[…], thisVisit[…] }
 *   POST { visitEventId, observations:[{practiceId,status,remarks?,action?,photoUrl?}] }
 *
 * Read gated by auth; write gated by pitstop_event.update (the visit-action
 * permission, same as the upload + mark-done routes).
 */

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { buildRbacContext, can } from "@/lib/rbac";
import { captureCaregiverPractices, type ObservationInput } from "@/lib/captureCaregiverPractices";
import { OPEN_PRACTICE_STATUSES } from "@/lib/caregiverPractices";

export const dynamic = "force-dynamic";

type OpenFlagRow = {
  practiceId: string;
  status: string;
  remarks: string | null;
  action: string | null;
  capturedAt: Date;
  code: string;
  shortLabel: string;
  categoryId: string;
  subcategory: string;
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ goalId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { goalId } = await params;
  const visitEventId = new URL(req.url).searchParams.get("visitEventId");

  const goal = await prisma.goal.findFirst({
    where: { id: goalId, deletedAt: null },
    select: {
      linkedFacility: { select: { id: true } },
    },
  });
  const facilityId = goal?.linkedFacility?.id ?? null;
  if (!facilityId) return Response.json({ facilityLinked: false, categories: [], openFlags: [], thisVisit: [] });

  // Taxonomy (active) → nested category → subcategory → practices.
  const categories = await prisma.caregiverPracticeCategory.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      practices: {
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        select: { id: true, code: true, shortLabel: true, fullText: true, subcategory: true, trainingModule: true },
      },
    },
  });
  const nested = categories.map((c) => {
    const bySub = new Map<string, typeof c.practices>();
    for (const p of c.practices) bySub.set(p.subcategory, [...(bySub.get(p.subcategory) ?? []), p]);
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      practiceCount: c.practices.length,
      subcategories: [...bySub.entries()].map(([label, practices]) => ({ label, practices })),
    };
  });

  // This visit's already-saved observations (for reopen/edit).
  const thisVisit = visitEventId
    ? await prisma.caregiverPracticeObservation.findMany({
        where: { visitEventId },
        select: { practiceId: true, status: true, remarks: true, action: true, photoUrl: true },
      })
    : [];
  const thisVisitPractices = new Set(thisVisit.map((o) => o.practiceId));

  // Carry-forward open flags: latest observation per (facility, practice), open status,
  // excluding practices already handled in this visit.
  const latest = await prisma.$queryRaw<OpenFlagRow[]>`
    SELECT DISTINCT ON (o."practiceId")
      o."practiceId", o.status::text AS status, o.remarks, o.action::text AS action, o."capturedAt",
      pr.code, pr."shortLabel", pr."categoryId", pr.subcategory
    FROM "CaregiverPracticeObservation" o
    JOIN "CaregiverPractice" pr ON pr.id = o."practiceId"
    WHERE o."facilityId" = ${facilityId} AND pr."isActive" = true
    ORDER BY o."practiceId", o."capturedAt" DESC, o.id DESC
  `;
  const openStatuses = new Set<string>(OPEN_PRACTICE_STATUSES);
  const openFlags = latest
    .filter((r) => openStatuses.has(r.status) && !thisVisitPractices.has(r.practiceId))
    .map((r) => ({
      practiceId: r.practiceId,
      code: r.code,
      shortLabel: r.shortLabel,
      categoryId: r.categoryId,
      subcategory: r.subcategory,
      prevStatus: r.status,
      prevRemarks: r.remarks,
      prevAction: r.action,
      lastCapturedAt: r.capturedAt.toISOString(),
    }));

  return Response.json({ facilityLinked: true, categories: nested, openFlags, thisVisit });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ goalId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ctx = await buildRbacContext(session, { req });
  if (!ctx || !(await can(ctx, "pitstop_event", "update"))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  await params; // goalId not needed — context resolves from the visit event
  const body = await req.json().catch(() => null);
  const visitEventId = typeof body?.visitEventId === "string" ? body.visitEventId : null;
  const observations = Array.isArray(body?.observations) ? (body.observations as ObservationInput[]) : null;
  if (!visitEventId || !observations) {
    return Response.json({ error: "visitEventId + observations required" }, { status: 400 });
  }

  const { written, escalated } = await captureCaregiverPractices({
    visitEventId,
    capturedById: session.user.id,
    observations,
  });
  return Response.json({ ok: true, written, escalated });
}
