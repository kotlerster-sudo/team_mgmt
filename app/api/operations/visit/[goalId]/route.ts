import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { resolveEffectiveCatalog, resolveCadence, type CatalogCategory, type CentreCatalogOverrides } from "@/lib/catalogDb";
import { monthBounds, requiredVisitsForMonth } from "@/lib/operations/month";

// Shared loader: resolves a live centre's catalog + cadence + the current-month in-progress visit
// for this user (if any) and which of its items are ticked.
async function loadScreen(goalId: string, userId: string) {
  const goal = await prisma.goal.findUnique({
    where: { id: goalId },
    select: {
      id: true, title: true, mode: true,
      needsCluster: { select: { id: true, name: true } },
      needsSettlement: { select: { id: true, name: true, cluster: { select: { id: true, name: true } } } },
      centreCatalog: { select: { catalogSlug: true, snapshot: true, overrides: true, cadenceCount: true, cadencePeriod: true } },
      pitstops: { where: { deletedAt: null, recurrence: { not: "None" } }, select: { id: true }, orderBy: { createdAt: "asc" }, take: 1 },
    },
  });
  if (!goal || !goal.centreCatalog || goal.pitstops.length === 0) return null;

  const livePitstopId = goal.pitstops[0].id;
  const snapshot = (goal.centreCatalog.snapshot ?? []) as unknown as CatalogCategory[];
  const overrides = (goal.centreCatalog.overrides ?? {}) as unknown as CentreCatalogOverrides;
  const cadence = resolveCadence(goal.centreCatalog, {
    defaultCadenceCount: null, defaultCadencePeriod: null,
  });

  const { start, end } = monthBounds();

  // Current-month in-progress visit for this user.
  const currentVisit = await prisma.pitstopEvent.findFirst({
    where: {
      type: "Visit", visitEventId: null, deletedAt: null,
      status: { notIn: ["Done", "Cancelled"] },
      scheduledAt: { gte: start, lte: end },
      pitstops: { some: { pitstopId: livePitstopId } },
      OR: [{ createdById: userId }, { attendees: { some: { userId } } }],
    },
    select: { id: true, arrivedAt: true },
    orderBy: { createdAt: "desc" },
  });

  // Ticked item keys for the current visit.
  let tickedKeys: string[] = [];
  if (currentVisit) {
    const children = await prisma.pitstopEvent.findMany({
      where: { visitEventId: currentVisit.id, deletedAt: null, status: "Done" },
      select: { templateKey: true },
    });
    tickedKeys = children.map((c) => c.templateKey).filter((k): k is string => Boolean(k));
  }

  // Cadence progress: parent visits done this month.
  const doneThisMonth = await prisma.pitstopEvent.count({
    where: {
      type: "Visit", visitEventId: null, status: "Done", deletedAt: null,
      completedAt: { gte: start, lte: end },
      pitstops: { some: { pitstopId: livePitstopId } },
    },
  });

  // Approval status for ad-hoc items (layered on top of the pure catalog resolve).
  const approvals = await prisma.catalogItemApproval.findMany({
    where: { goalId },
    select: { itemKey: true, status: true },
  });
  const approvalByKey = new Map(approvals.map((a) => [a.itemKey, a.status]));

  const ticked = new Set(tickedKeys);
  const categories = resolveEffectiveCatalog(snapshot, overrides).map((cat) => ({
    key: cat.key,
    label: cat.label,
    items: cat.items.map((it) => ({
      key: it.key, text: it.text, completionType: it.completionType,
      mandatory: it.blocksSignoff, source: it.source, ticked: ticked.has(it.key),
      approval: approvalByKey.get(it.key) ?? null,
    })),
  }));

  return {
    goal: {
      id: goal.id,
      title: goal.title,
      clusterName: goal.needsCluster?.name ?? goal.needsSettlement?.cluster?.name ?? null,
      settlementName: goal.needsSettlement?.name ?? null,
    },
    catalogSlug: goal.centreCatalog.catalogSlug,
    livePitstopId,
    cadence,
    monthRequired: requiredVisitsForMonth(cadence),
    monthDone: doneThisMonth,
    currentVisit: currentVisit ? { id: currentVisit.id, arrivedAt: currentVisit.arrivedAt } : null,
    categories,
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ goalId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { goalId } = await params;
  const data = await loadScreen(goalId, session.user.id);
  if (!data) return Response.json({ error: "Not a live centre" }, { status: 404 });
  return Response.json(data);
}

// Get-or-create the current-month visit for this centre, optionally stamping arrival.
export async function POST(req: NextRequest, { params }: { params: Promise<{ goalId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { goalId } = await params;
  const userId = session.user.id;
  const body = await req.json().catch(() => ({}));

  const data = await loadScreen(goalId, userId);
  if (!data) return Response.json({ error: "Not a live centre" }, { status: 404 });

  let visitId = data.currentVisit?.id ?? null;
  if (!visitId) {
    const now = new Date(); // soft month anchor — no specific day assigned
    const created = await prisma.pitstopEvent.create({
      data: {
        title: `Visit — ${data.goal.title}`,
        type: "Visit",
        status: "Scheduled",
        scheduledAt: now,
        originalScheduledAt: now,
        createdById: userId,
        lastUpdatedById: userId,
        pitstops: { create: [{ pitstopId: data.livePitstopId }] },
        attendees: { create: [{ userId, status: "accepted" }] },
      },
      select: { id: true },
    });
    visitId = created.id;
  }

  if (body?.arrive) {
    await prisma.pitstopEvent.update({
      where: { id: visitId },
      data: { arrivedAt: new Date(), arrivedById: userId, lastUpdatedById: userId },
    });
  }

  return Response.json({ ok: true, visitId });
}
