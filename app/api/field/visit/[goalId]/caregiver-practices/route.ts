// Caregiver-practice capture for a /field cadence visit. FieldVisit-keyed sibling
// of /api/operations/visit/[goalId]/caregiver-practices.
//   GET  ?fieldVisitId=…  → { facilityLinked, categories[], openFlags[], thisVisit[] }
//   POST { fieldVisitId, observations:[{practiceId,status,remarks?,action?,photoUrl?}] }
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { OPEN_PRACTICE_STATUSES } from "@/lib/caregiverPractices";
import { captureFieldCaregiverPractices } from "@/lib/field/caregiver";
import { assertFieldGoalAccess } from "@/lib/field/access";
import type { ObservationInput } from "@/lib/captureCaregiverPractices";

export const dynamic = "force-dynamic";

type OpenFlagRow = {
  practiceId: string; status: string; remarks: string | null; action: string | null;
  capturedAt: Date; code: string; shortLabel: string; categoryId: string; subcategory: string;
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ goalId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { goalId } = await params;
  const fieldVisitId = new URL(req.url).searchParams.get("fieldVisitId");

  const goal = await prisma.goal.findFirst({ where: { id: goalId, deletedAt: null }, select: { linkedFacility: { select: { id: true } } } });
  const facilityId = goal?.linkedFacility?.id ?? null;
  if (!facilityId) return Response.json({ facilityLinked: false, categories: [], openFlags: [], thisVisit: [] });

  const categories = await prisma.caregiverPracticeCategory.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true, code: true, name: true,
      practices: { where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, code: true, shortLabel: true, fullText: true, subcategory: true, trainingModule: true } },
    },
  });
  const nested = categories.map((c) => {
    const bySub = new Map<string, typeof c.practices>();
    for (const p of c.practices) bySub.set(p.subcategory, [...(bySub.get(p.subcategory) ?? []), p]);
    return { id: c.id, code: c.code, name: c.name, practiceCount: c.practices.length, subcategories: [...bySub.entries()].map(([label, practices]) => ({ label, practices })) };
  });

  const thisVisit = fieldVisitId
    ? await prisma.caregiverPracticeObservation.findMany({ where: { fieldVisitId }, select: { practiceId: true, status: true, remarks: true, action: true, photoUrl: true } })
    : [];
  const thisVisitPractices = new Set(thisVisit.map((o) => o.practiceId));

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
    .map((r) => ({ practiceId: r.practiceId, code: r.code, shortLabel: r.shortLabel, categoryId: r.categoryId, subcategory: r.subcategory, prevStatus: r.status, prevRemarks: r.remarks, prevAction: r.action, lastCapturedAt: r.capturedAt.toISOString() }));

  return Response.json({ facilityLinked: true, categories: nested, openFlags, thisVisit });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ goalId: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { goalId } = await params;
  if (!(await assertFieldGoalAccess(userId, goalId))) return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const fieldVisitId = typeof body?.fieldVisitId === "string" ? body.fieldVisitId : null;
  const observations = Array.isArray(body?.observations) ? (body.observations as ObservationInput[]) : null;
  if (!fieldVisitId || !observations) return Response.json({ error: "fieldVisitId + observations required" }, { status: 400 });

  const { written, escalated } = await captureFieldCaregiverPractices({ fieldVisitId, capturedById: userId, observations });
  return Response.json({ ok: true, written, escalated });
}
