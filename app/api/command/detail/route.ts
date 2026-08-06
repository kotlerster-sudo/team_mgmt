/**
 * Command-center right-panel detail for one goal (centre).
 *
 *   GET ?goalId=…
 *
 * Bundles everything the leader drills into on a single centre:
 *   - the setup WBS plan (loadCentrePlan — setup goals only)
 *   - the last 12 cadence visits with observations: visit note, thread
 *     messages (text + voice), scored-indicator captures incl. failed
 *     non-negotiables, and follow-ups raised on the visit
 *   - 12-month indicator time-series (settlement grain)
 *   - open + recently-closed ActionPoints with ageing
 *
 * Note: FacilityIndicatorPoint.sourceRefId holds the CHECKLIST-ITEM id (see
 * lib/captureIndicatorPoints.ts), so captures attach to a visit via its child
 * events' checklistItemId — not via the event id directly.
 */

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { buildRbacContext, can } from "@/lib/rbac";
import { goalZoneId, resolveCommandScope } from "@/lib/operations/command";
import { loadCentrePlan } from "@/lib/operations/plan";
import { loadLayerToDomain, resolveGoalThemeKey } from "@/lib/operations/themes";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;
const VISIT_LIMIT = 12;
const SERIES_MONTHS = 12;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ctx = await buildRbacContext(session, { req });
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await can(ctx, "command_center", "read"))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const goalId = url.searchParams.get("goalId");
  if (!goalId) return Response.json({ error: "goalId required" }, { status: 400 });

  // Geographic authorization: the goal's zone must be in the caller's allowed set.
  const [zone, allowedZones] = await Promise.all([goalZoneId(goalId), resolveCommandScope(ctx)]);
  if (!zone) return Response.json({ error: "Not found" }, { status: 404 });
  if (!allowedZones.some((z) => z.id === zone)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const goal = await prisma.goal.findFirst({
    where: { id: goalId, deletedAt: null },
    select: {
      id: true,
      title: true,
      mode: true,
      needsDomain: true,
      targetDate: true,
      owner: { select: { id: true, name: true } },
      needsSettlement: { select: { id: true, name: true } },
      linkedFacility: {
        select: {
          id: true,
          name: true,
          layerKey: true,
          lat: true,
          lng: true,
          settlement: { select: { id: true, name: true } },
          cluster: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!goal) return Response.json({ error: "Not found" }, { status: 404 });

  const now = new Date();
  const seriesStart = new Date(now.getFullYear(), now.getMonth() - (SERIES_MONTHS - 1), 1);
  const settlementId = goal.linkedFacility?.settlement?.id ?? goal.needsSettlement?.id ?? null;
  const facilityId = goal.linkedFacility?.id ?? null;
  const layerToDomain = await loadLayerToDomain();
  const themeKey = resolveGoalThemeKey(goal, layerToDomain);

  // ── Visits (parent cadence visits, newest first) ──────────────────────────
  const visitEvents = await prisma.pitstopEvent.findMany({
    where: {
      type: "Visit",
      visitEventId: null,
      deletedAt: null,
      pitstops: { some: { pitstop: { deletedAt: null, goalId, recurrence: { not: "None" } } } },
    },
    orderBy: { scheduledAt: "desc" },
    take: VISIT_LIMIT,
    select: {
      id: true,
      title: true,
      status: true,
      scheduledAt: true,
      arrivedAt: true,
      completedAt: true,
      description: true,
      completedBy: { select: { name: true } },
      childEvents: {
        where: { deletedAt: null },
        select: { id: true, checklistItemId: true },
      },
    },
  });

  const allEventIds = visitEvents.flatMap((v) => [v.id, ...v.childEvents.map((c) => c.id)]);
  const allChecklistIds = visitEvents.flatMap((v) =>
    v.childEvents.map((c) => c.checklistItemId).filter((id): id is string => !!id),
  );

  const [threads, captures, visitAps, seriesPoints, openAps, closedAps] = await Promise.all([
    allEventIds.length > 0
      ? prisma.thread.findMany({
          where: { eventId: { in: allEventIds }, deletedAt: null },
          select: {
            eventId: true,
            messages: {
              where: { deletedAt: null },
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                body: true,
                msgType: true,
                audioUrl: true,
                createdAt: true,
                author: { select: { name: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
    allChecklistIds.length > 0
      ? prisma.facilityIndicatorPoint.findMany({
          where: { sourceRefId: { in: allChecklistIds } },
          select: {
            sourceRefId: true,
            value: true,
            note: true,
            capturedAt: true,
            indicator: { select: { def: { select: { label: true, unit: true } } } },
            answers: {
              where: { answer: "no" },
              select: { itemDef: { select: { text: true, nonNegotiable: true } } },
            },
          },
        })
      : Promise.resolve([]),
    allEventIds.length > 0
      ? prisma.actionPoint.groupBy({
          by: ["pitstopEventId"],
          where: { pitstopEventId: { in: allEventIds } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    settlementId
      ? prisma.facilityIndicatorPoint.findMany({
          where: {
            capturedAt: { gte: seriesStart },
            indicator: {
              settlementId,
              // This centre's own facility series, plus settlement-level as fallback.
              OR: [{ facilityId }, { facilityId: null }],
              ...(themeKey ? { def: { domain: themeKey, isActive: true } } : { def: { isActive: true } }),
            },
          },
          orderBy: { capturedAt: "asc" },
          select: {
            value: true,
            capturedAt: true,
            source: true,
            indicator: {
              select: {
                targetValue: true,
                facilityId: true,
                def: { select: { id: true, key: true, label: true, unit: true, sortOrder: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
    prisma.actionPoint.findMany({
      where: { goalId, status: "open" },
      orderBy: { dueDate: "asc" },
      select: {
        id: true,
        title: true,
        detail: true,
        partnerStaffLabel: true,
        priority: true,
        dueDate: true,
        createdAt: true,
        owner: { select: { name: true } },
      },
    }),
    prisma.actionPoint.findMany({
      where: { goalId, status: "done" },
      orderBy: { completedAt: "desc" },
      take: 5,
      select: {
        id: true,
        title: true,
        closureNote: true,
        dueDate: true,
        completedAt: true,
        completedBy: { select: { name: true } },
      },
    }),
  ]);

  // Setup WBS plan — setup goals only (live centres link to the plan page instead).
  const plan = goal.mode === "setup" ? await loadCentrePlan(goalId) : null;

  const messagesByEvent = new Map<string, (typeof threads)[number]["messages"]>();
  for (const t of threads) {
    if (!t.eventId) continue;
    const list = messagesByEvent.get(t.eventId) ?? [];
    messagesByEvent.set(t.eventId, [...list, ...t.messages]);
  }
  const capturesByChecklist = new Map<string, typeof captures>();
  for (const c of captures) {
    if (!c.sourceRefId) continue;
    const list = capturesByChecklist.get(c.sourceRefId) ?? [];
    list.push(c);
    capturesByChecklist.set(c.sourceRefId, list);
  }
  const apCountByEvent = new Map(visitAps.map((r) => [r.pitstopEventId, r._count._all]));

  const visits = visitEvents.map((v) => {
    const childIds = v.childEvents.map((c) => c.id);
    const messages = [v.id, ...childIds]
      .flatMap((id) => messagesByEvent.get(id) ?? [])
      .map((m) => ({
        id: m.id,
        body: m.body,
        msgType: m.msgType,
        audioUrl: m.audioUrl,
        author: m.author?.name ?? null,
        createdAt: m.createdAt.toISOString(),
      }));
    const visitCaptures = v.childEvents
      .map((c) => c.checklistItemId)
      .filter((id): id is string => !!id)
      .flatMap((id) => capturesByChecklist.get(id) ?? [])
      .map((c) => ({
        defLabel: c.indicator.def.label,
        unit: c.indicator.def.unit,
        value: c.value,
        note: c.note,
        capturedAt: c.capturedAt.toISOString(),
        failedItems: c.answers.map((a) => a.itemDef.text),
        failedNonNegotiables: c.answers.filter((a) => a.itemDef.nonNegotiable).map((a) => a.itemDef.text),
      }));
    const apsRaised = [v.id, ...childIds].reduce((s, id) => s + (apCountByEvent.get(id) ?? 0), 0);
    return {
      eventId: v.id,
      title: v.title,
      status: v.status,
      scheduledAt: v.scheduledAt.toISOString(),
      arrivedAt: v.arrivedAt ? v.arrivedAt.toISOString() : null,
      completedAt: v.completedAt ? v.completedAt.toISOString() : null,
      completedBy: v.completedBy?.name ?? null,
      description: v.description,
      messages,
      captures: visitCaptures,
      apsRaised,
    };
  });

  // Indicator series grouped by def. Per def, prefer this facility's own points;
  // fall back to settlement-level points only when the facility has none.
  const defHasFacilityPoints = new Set(
    seriesPoints.filter((p) => p.indicator.facilityId === facilityId && facilityId != null).map((p) => p.indicator.def.id),
  );
  const seriesByDef = new Map<
    string,
    {
      def: { id: string; key: string; label: string; unit: string | null; sortOrder: number };
      target: number | null;
      series: { capturedAt: string; value: number; source: string }[];
    }
  >();
  for (const p of seriesPoints) {
    const def = p.indicator.def;
    // If the facility has its own series for this def, drop the settlement-level points.
    if (defHasFacilityPoints.has(def.id) && p.indicator.facilityId !== facilityId) continue;
    const entry = seriesByDef.get(def.id) ?? { def, target: p.indicator.targetValue, series: [] };
    entry.series.push({ capturedAt: p.capturedAt.toISOString(), value: p.value, source: p.source });
    seriesByDef.set(def.id, entry);
  }
  const indicators = [...seriesByDef.values()].sort((a, b) => a.def.sortOrder - b.def.sortOrder);

  const ageDays = (due: Date) => Math.max(0, Math.ceil((now.getTime() - due.getTime()) / DAY_MS));

  return Response.json({
    goal: {
      id: goal.id,
      title: goal.title,
      mode: goal.mode,
      themeKey,
      targetDate: goal.targetDate ? goal.targetDate.toISOString() : null,
    },
    facility: goal.linkedFacility
      ? {
          id: goal.linkedFacility.id,
          name: goal.linkedFacility.name,
          layerKey: goal.linkedFacility.layerKey,
          lat: goal.linkedFacility.lat,
          lng: goal.linkedFacility.lng,
          settlement: goal.linkedFacility.settlement,
          cluster: goal.linkedFacility.cluster,
        }
      : null,
    rp: goal.owner ? { id: goal.owner.id, name: goal.owner.name } : null,
    plan,
    visits,
    indicators,
    actionPoints: {
      open: openAps.map((a) => ({
        id: a.id,
        title: a.title,
        detail: a.detail,
        partnerStaffLabel: a.partnerStaffLabel,
        priority: a.priority,
        dueDate: a.dueDate.toISOString(),
        createdAt: a.createdAt.toISOString(),
        owner: a.owner?.name ?? null,
        ageDays: ageDays(a.dueDate),
      })),
      recentClosed: closedAps.map((a) => ({
        id: a.id,
        title: a.title,
        closureNote: a.closureNote,
        dueDate: a.dueDate.toISOString(),
        completedAt: a.completedAt ? a.completedAt.toISOString() : null,
        completedBy: a.completedBy?.name ?? null,
      })),
    },
  });
}
