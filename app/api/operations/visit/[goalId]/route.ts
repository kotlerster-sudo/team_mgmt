import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { monthBounds } from "@/lib/operations/month";
import { loadCentreCatalogView } from "@/lib/operations/catalogView";

// Shared loader: resolves a live centre's catalog + cadence (via loadCentreCatalogView — one
// source of truth) then layers the current-month in-progress visit for this user + which of
// its items are ticked.
async function loadScreen(goalId: string, userId: string) {
  const view = await loadCentreCatalogView(goalId);
  if (!view || !view.live) return null;
  const { livePitstopId, catalogSlug, cadence, monthRequired, monthDone, categories } = view.live;

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

  const ticked = new Set(tickedKeys);
  const withTicked = categories.map((cat) => ({
    key: cat.key,
    label: cat.label,
    items: cat.items.map((it) => ({ ...it, ticked: ticked.has(it.key) })),
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
    categories: withTicked,
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
