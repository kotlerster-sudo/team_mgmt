/**
 * ActionPoint list + batch-create.
 *
 *   GET    ?scope=mine|team        — defaults to "mine" (status=open ∧ owner=me)
 *          &bucket=overdue|today|week|done
 *          &pitstopId=…  &goalId=…
 *          &status=open|done|cancelled
 *
 *   POST   batch create. Body: { items: [{ pitstopEventId, title, dueDate, … }] }
 *          The RP raising the APs is set as both owner and creator. Goal + pitstop
 *          are looked up from the referenced PitstopEvent so callers don't have
 *          to know the hierarchy. See model docstring in schema.prisma.
 */

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { viewerForbidden } from "@/lib/roleGuard";
import { buildRbacContext, scopeWhere, can } from "@/lib/rbac";
import { getVisibleUserIds } from "@/lib/visibilityScope";
import { auditLog } from "@/lib/auditLog";

const selectFull = {
  id: true,
  source: true,
  goalId: true,
  pitstopId: true,
  pitstopEventId: true,
  needsSettlementId: true,
  needsClusterId: true,
  needsZoneId: true,
  needsCityId: true,
  catalogItemKey: true,
  assignedById: true,
  title: true,
  detail: true,
  partnerStaffLabel: true,
  ownerId: true,
  dueDate: true,
  priority: true,
  status: true,
  closureNote: true,
  closureProofUrl: true,
  completedAt: true,
  completedById: true,
  createdAt: true,
  createdById: true,
  updatedAt: true,
  lastUpdatedById: true,
  owner:       { select: { id: true, name: true, image: true } },
  createdBy:   { select: { id: true, name: true, image: true } },
  completedBy: { select: { id: true, name: true, image: true } },
  pitstop:     { select: { id: true, title: true, goalId: true } },
  goal:        { select: { id: true, title: true } },
  pitstopEvent: { select: { id: true, title: true, scheduledAt: true } },
  assignedBy:  { select: { id: true, name: true, image: true } },
  needsSettlement: { select: { id: true, name: true } },
  needsCluster:    { select: { id: true, name: true } },
  needsZone:       { select: { id: true, name: true } },
  needsCity:       { select: { id: true, name: true } },
} as const;

// IST-aware day boundaries — same convention as Home today/overdue queries.
// Activities in this app are bucketed by IST calendar day; we mirror that here
// so an AP due "today" lines up with the activities the RP sees on Today.
function istDayBounds(now = new Date()): { dayStart: Date; dayEnd: Date } {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000); // shift to IST clock
  const y = ist.getUTCFullYear(), m = ist.getUTCMonth(), d = ist.getUTCDate();
  // Day boundaries in IST → convert back to UTC for the query
  const dayStart = new Date(Date.UTC(y, m, d, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
  const dayEnd = new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - 5.5 * 60 * 60 * 1000);
  return { dayStart, dayEnd };
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ctx = await buildRbacContext(session, { req });
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const scope     = (url.searchParams.get("scope") ?? "mine") as "mine" | "team";
  const bucket    = url.searchParams.get("bucket"); // overdue|today|week|done|null
  const statusArg = url.searchParams.get("status"); // open|done|cancelled|null
  const pitstopId = url.searchParams.get("pitstopId");
  const goalId    = url.searchParams.get("goalId");
  const source    = url.searchParams.get("source"); // activity|adhoc|null (both)
  // "tasks I handed to someone else" — the other half of an assigner's view,
  // since those rows are owned by the assignee and so miss scope=mine.
  const assignedByMe = url.searchParams.get("assignedByMe") === "1";

  // "mine" → just my own APs (ownerId=me). "team" → use RBAC team scope
  // (TEAM expands to reportsToId tree, which is what ZL/PM/Leader want).
  let where: Record<string, unknown> = {};
  if (assignedByMe) {
    where = { assignedById: ctx.userId };
  } else if (scope === "team") {
    const rbacWhere = await scopeWhere(ctx, "action_point", "list");
    if (rbacWhere === null) return Response.json([], { status: 200 });
    where = { ...rbacWhere };
  } else {
    where = { ownerId: ctx.userId };
  }

  if (pitstopId) where.pitstopId = pitstopId;
  if (goalId)    where.goalId    = goalId;
  if (source === "activity" || source === "adhoc") where.source = source;

  // Bucket filter: shapes status + dueDate range together so the four Home
  // panels (Overdue/Today/Week/Done) map to one query each.
  const { dayStart, dayEnd } = istDayBounds();
  if (bucket === "overdue") {
    where.status = "open";
    where.dueDate = { lt: dayStart };
  } else if (bucket === "today") {
    where.status = "open";
    where.dueDate = { gte: dayStart, lte: dayEnd };
  } else if (bucket === "week") {
    where.status = "open";
    const weekEnd = new Date(dayEnd.getTime() + 6 * 24 * 60 * 60 * 1000);
    where.dueDate = { gte: dayStart, lte: weekEnd };
  } else if (bucket === "later") {
    // Open APs scheduled more than 6 days out. Catches anything the
    // close-out modal pushed to the next visit cycle (commonly 7-30 days
    // ahead) that would otherwise fall off the bottom of "This week".
    where.status = "open";
    const weekEnd = new Date(dayEnd.getTime() + 6 * 24 * 60 * 60 * 1000);
    where.dueDate = { gt: weekEnd };
  } else if (bucket === "done") {
    where.status = "done";
    const thirtyAgo = new Date(dayStart.getTime() - 30 * 24 * 60 * 60 * 1000);
    where.completedAt = { gte: thirtyAgo };
  } else if (statusArg) {
    where.status = statusArg;
  } else {
    where.status = "open";
  }

  const orderBy = bucket === "done"
    ? [{ completedAt: "desc" as const }]
    : [{ dueDate: "asc" as const }, { createdAt: "asc" as const }];

  const rows = await prisma.actionPoint.findMany({ where, orderBy, select: selectFull, take: 500 });
  return Response.json(rows);
}

type ApInput = {
  // Present → a visit follow-up (source 'activity'), hierarchy resolved from the
  // event. Absent → an ad-hoc task (source 'adhoc') scoped by whatever of
  // goalId / needs* the caller supplies, all of them optional.
  pitstopEventId?: string;
  title: string;
  detail?: string | null;
  dueDate: string; // ISO
  priority?: "routine" | "urgent";
  partnerStaffLabel?: string | null;
  assigneeId?: string | null;
  goalId?: string | null;
  needsSettlementId?: string | null;
  needsClusterId?: string | null;
  needsZoneId?: string | null;
  needsCityId?: string | null;
};

type PreparedAp = {
  source: "activity" | "adhoc";
  pitstopEventId: string | null;
  pitstopId: string | null;
  goalId: string | null;
  needsSettlementId: string | null;
  needsClusterId: string | null;
  needsZoneId: string | null;
  needsCityId: string | null;
  title: string;
  detail: string | null;
  dueDate: Date;
  priority: string;
  partnerStaffLabel: string | null;
  ownerId: string;
  assignedById: string | null;
};

// The four needs* ids and goalId arrive straight from a picker, so a stale or
// wrong id would otherwise surface as a 500 from the FK constraint. Batch-check
// each level once and return a 400 the client can show.
async function validateScopeRefs(prepared: PreparedAp[]): Promise<string | null> {
  const ids = (pick: (p: PreparedAp) => string | null) =>
    Array.from(new Set(prepared.map(pick).filter((v): v is string => !!v)));

  const checks: [string, string[], (where: { id: { in: string[] } }) => Promise<{ id: string }[]>][] = [
    ["goal",       ids((p) => p.goalId),             (w) => prisma.goal.findMany({ where: w, select: { id: true } })],
    ["settlement", ids((p) => p.needsSettlementId),  (w) => prisma.settlement.findMany({ where: w, select: { id: true } })],
    ["cluster",    ids((p) => p.needsClusterId),     (w) => prisma.cluster.findMany({ where: w, select: { id: true } })],
    ["zone",       ids((p) => p.needsZoneId),        (w) => prisma.zone.findMany({ where: w, select: { id: true } })],
    ["city",       ids((p) => p.needsCityId),        (w) => prisma.city.findMany({ where: w, select: { id: true } })],
  ];

  for (const [label, wanted, load] of checks) {
    if (!wanted.length) continue;
    const found = await load({ id: { in: wanted } });
    if (found.length !== wanted.length) {
      const missing = wanted.filter((id) => !found.some((f) => f.id === id));
      return `Unknown ${label}: ${missing.join(", ")}`;
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const veto = viewerForbidden(session); if (veto) return veto;
  const actorId = session.user.id;

  const body = await req.json();
  // Accept either a single item or an array — close-out modal posts an array
  // even when there's one row, but we let other callers (e.g. quick-add on a
  // pitstop) post a single object too.
  const items: ApInput[] = Array.isArray(body) ? body : (body?.items ?? [body]);
  if (!Array.isArray(items) || items.length === 0) {
    return Response.json({ error: "No items provided" }, { status: 400 });
  }

  // Resolve goalId + pitstopId for every distinct pitstopEventId in one shot.
  // The first linked pitstop wins — APs nest under the activity, and an activity
  // sometimes has multiple pitstops; we anchor to the canonical first for the
  // hierarchy denormalization.
  const eventIds = Array.from(new Set(items.map((i) => i.pitstopEventId).filter((id): id is string => !!id)));
  const events = eventIds.length
    ? await prisma.pitstopEvent.findMany({
        where: { id: { in: eventIds } },
        select: {
          id: true,
          pitstops: {
            select: { pitstop: { select: { id: true, goalId: true } } },
            take: 1,
          },
        },
      })
    : [];
  const hierarchy = new Map<string, { pitstopId: string; goalId: string }>();
  for (const ev of events) {
    const p = ev.pitstops[0]?.pitstop;
    if (p) hierarchy.set(ev.id, { pitstopId: p.id, goalId: p.goalId });
  }

  // Who this actor may hand a task to. TEAM resolves to just themselves for an
  // RP, so the same check covers self-assignment without a special case. Loaded
  // once, and only when some row actually delegates.
  const delegates = items.some((i) => i.assigneeId && i.assigneeId !== actorId);
  let assignableIds: Set<string> | null = null;
  if (delegates) {
    const ctx = await buildRbacContext(session, { req });
    if (!ctx || !(await can(ctx, "action_point", "assign"))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    assignableIds = new Set(await getVisibleUserIds(ctx));
  }

  // Validate first — if any row is bad, fail the whole batch (close-out flow
  // shouldn't half-create APs and leave the RP with an unclear state).
  const prepared: PreparedAp[] = [];
  for (const it of items) {
    if (!it.title?.trim() || !it.dueDate) {
      return Response.json({ error: "Each item needs title and dueDate" }, { status: 400 });
    }
    const due = new Date(it.dueDate);
    if (Number.isNaN(due.getTime())) return Response.json({ error: "Invalid dueDate" }, { status: 400 });

    const common = {
      title: it.title.trim(),
      detail: it.detail?.trim() || null,
      dueDate: due,
      priority: it.priority === "urgent" ? "urgent" : "routine",
      partnerStaffLabel: it.partnerStaffLabel?.trim() || null,
    };

    if (it.pitstopEventId) {
      const h = hierarchy.get(it.pitstopEventId);
      if (!h) return Response.json({ error: `Unknown pitstopEvent: ${it.pitstopEventId}` }, { status: 400 });
      prepared.push({
        ...common, source: "activity",
        pitstopEventId: it.pitstopEventId, pitstopId: h.pitstopId, goalId: h.goalId,
        needsSettlementId: null, needsClusterId: null, needsZoneId: null, needsCityId: null,
        ownerId: actorId, assignedById: null,
      });
      continue;
    }

    const assignee = it.assigneeId?.trim() || actorId;
    if (assignee !== actorId && !assignableIds?.has(assignee)) {
      return Response.json({ error: "Not in your team" }, { status: 403 });
    }
    prepared.push({
      ...common, source: "adhoc",
      pitstopEventId: null, pitstopId: null, goalId: it.goalId || null,
      needsSettlementId: it.needsSettlementId || null,
      needsClusterId: it.needsClusterId || null,
      needsZoneId: it.needsZoneId || null,
      needsCityId: it.needsCityId || null,
      ownerId: assignee,
      assignedById: assignee === actorId ? null : actorId,
    });
  }

  const scopeError = await validateScopeRefs(prepared);
  if (scopeError) return Response.json({ error: scopeError }, { status: 400 });

  // Sequential creates so we can capture ids for the audit log; the batch is
  // typically 1–5 rows so the cost is fine.
  const created = [];
  for (const p of prepared) {
    const row = await prisma.actionPoint.create({
      data: {
        ...p,               // carries ownerId — self for a visit follow-up, the delegate for an assigned task
        createdById: actorId,
        status: "open",
      },
      select: selectFull,
    });
    created.push(row);
    auditLog({
      entityType: "ActionPoint", entityId: row.id, userId: actorId,
      action: "created", newValue: row.title,
    });
  }

  return Response.json(created, { status: 201 });
}
