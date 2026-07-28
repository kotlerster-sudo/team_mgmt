import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { monthBounds } from "@/lib/operations/month";
import { loadCentreCatalogView } from "@/lib/operations/catalogView";
import { EVENT_SELECT } from "@/lib/operations/today";
import { materialiseVisitItems } from "@/lib/visits/materialise";

// Child-event select: the standard Activity shape (for ActivityCard) + the fields we need to map
// each event back to its catalog item and its checklist (for completionType-driven completion).
const VISIT_CHILD_SELECT = {
  ...EVENT_SELECT,
  templateKey: true,
  checklistItem: { select: { id: true, completionType: true } },
} as const;

// Shared loader: resolves a live centre's catalog + cadence (via loadCentreCatalogView) then, once
// the user has arrived, materialises the catalog into real child activities and returns them per
// category so the visit UI can complete each through the standard flow (completionType + follow-up).
async function loadScreen(goalId: string, userId: string) {
  const view = await loadCentreCatalogView(goalId);
  if (!view || !view.live) return null;
  const { livePitstopId, catalogSlug, cadence, monthRequired, monthDone, categories } = view.live;

  const { start, end } = monthBounds();

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

  // Once arrived, ensure the catalog is materialised (idempotent), then load the child activities.
  const byItemKey = new Map<string, { activity: unknown; checklistId: string | null; done: boolean }>();
  if (currentVisit?.arrivedAt) {
    await materialiseVisitItems(currentVisit.id, userId);
    const children = await prisma.pitstopEvent.findMany({
      where: { visitEventId: currentVisit.id, deletedAt: null, status: { not: "Cancelled" } },
      select: VISIT_CHILD_SELECT,
      orderBy: { scheduledAt: "asc" },
    });
    for (const c of children) {
      if (!c.templateKey) continue;
      byItemKey.set(c.templateKey, {
        activity: c,
        checklistId: c.checklistItem?.id ?? null,
        done: c.status === "Done",
      });
    }
  }

  const outCategories = categories.map((cat) => ({
    key: cat.key,
    label: cat.label,
    items: cat.items.map((it) => {
      const m = byItemKey.get(it.key);
      return {
        key: it.key, text: it.text, completionType: it.completionType,
        mandatory: it.mandatory, source: it.source, approval: it.approval,
        done: m?.done ?? false,
        activity: m?.activity ?? null,
        checklistId: m?.checklistId ?? null,
      };
    }),
  }));

  return {
    goal: {
      id: view.goalId,
      title: view.title,
      clusterName: view.clusterName,
      settlementName: view.settlementName,
    },
    catalogSlug,
    livePitstopId,
    cadence,
    monthRequired,
    monthDone,
    currentVisit: currentVisit ? { id: currentVisit.id, arrivedAt: currentVisit.arrivedAt } : null,
    categories: outCategories,
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
    // Materialise the catalog into completable activities on arrival.
    await materialiseVisitItems(visitId, userId);
  }

  return Response.json({ ok: true, visitId });
}
