/**
 * Command-center rollup loader — the leader-facing sibling of
 * `loadCentresForTheme` (lib/operations/centres.ts), scoped by GEOGRAPHY
 * (zone / cluster / settlement) instead of ownership.
 *
 * One loader produces one row per programme goal in scope (setup WBS goals and
 * live centres alike), each row carrying every pivot key the /command page
 * needs (cluster, settlement, RP, theme) so the geography / by-RP /
 * by-programme lenses are pure client-side regroupings of the same rows — the
 * three lenses can never disagree numerically.
 *
 * Reads the spine only — no new tables, no writes. All domain/theme knowledge
 * comes from admin-editable config (NeedsFormulaConfig, FacilityLayerConfig,
 * FacilityIndicatorDef) — nothing hardcoded.
 */

import type { Prisma } from "@/app/generated/prisma/client";
import prisma from "@/lib/prisma";
import { getVisibleUserIds } from "@/lib/visibilityScope";
import { deriveCentrePhase, type CentrePhase, type PhasePitstop } from "./phase";
import { computeCriticalPath, type CpNode } from "./criticalPath";
import { monthBounds, requiredVisitsForMonth, visitStatsByGoal, ymKey } from "./month";
import { resolveCadence } from "@/lib/catalogDb";
import {
  loadThemeCatalog,
  resolveGoalThemeKey,
  indexThemes,
  type ThemeDef,
} from "./themes";
import { orderProgressTags } from "@/lib/progressTags";

// ── Scope ────────────────────────────────────────────────────────────────────

export type CommandScope =
  | { kind: "zone"; id: string }
  | { kind: "cluster"; id: string }
  | { kind: "settlement"; id: string };

/**
 * Prisma Goal filter: goal belongs to this geography directly (needs* FK), via
 * its settlement's cluster/zone, or via its linked facility. Mirrors
 * `goalInClusterFilter` (lib/operations/clusters.ts) widened to all three levels.
 */
export function goalInScopeFilter(scope: CommandScope): Prisma.GoalWhereInput {
  switch (scope.kind) {
    case "zone":
      return {
        OR: [
          { needsZoneId: scope.id },
          { needsCluster: { zoneId: scope.id } },
          { needsSettlement: { cluster: { zoneId: scope.id } } },
          // LayerFeature carries its own zoneId, but some rows only have clusterId — check both.
          { linkedFacility: { OR: [{ zoneId: scope.id }, { cluster: { zoneId: scope.id } }] } },
        ],
      };
    case "cluster":
      return {
        OR: [
          { needsClusterId: scope.id },
          { needsSettlement: { clusterId: scope.id } },
          { linkedFacility: { clusterId: scope.id } },
        ],
      };
    case "settlement":
      return {
        OR: [
          { needsSettlementId: scope.id },
          { linkedFacility: { settlementId: scope.id } },
        ],
      };
  }
}

export type CommandZoneOption = { id: string; name: string; cityName: string | null };

/**
 * Which zones may this user open in the command center?
 *   admin / super-admin / Leader → all zones.
 *   ZL / PM → zones they (or their one-hop reports) lead, plus zones containing
 *             clusters where their visible users are assigned as RPs. The
 *             cluster fallback matters because Zone.leadId is nullable.
 *   RP / Other → none (page redirects away; grants also deny).
 */
export async function resolveCommandScope(ctx: {
  userId: string;
  role: string;
  designation: string;
}): Promise<CommandZoneOption[]> {
  const apex = ctx.role === "admin" || ctx.role === "super-admin" || ctx.designation === "Leader";
  const zoneSelect = { id: true, name: true, city: { select: { name: true } } } as const;
  const zoneOrder = [{ city: { name: "asc" } }, { name: "asc" }] as const;

  let zones: { id: string; name: string; city: { name: string } | null }[];
  if (apex) {
    zones = await prisma.zone.findMany({
      where: { deletedAt: null },
      select: zoneSelect,
      orderBy: [...zoneOrder],
    });
  } else if (ctx.designation === "ZL" || ctx.designation === "PM") {
    const visibleIds = await getVisibleUserIds(ctx);
    zones = await prisma.zone.findMany({
      where: {
        deletedAt: null,
        OR: [
          { leadId: { in: visibleIds } },
          { clusters: { some: { deletedAt: null, rps: { some: { id: { in: visibleIds } } } } } },
        ],
      },
      select: zoneSelect,
      orderBy: [...zoneOrder],
    });
  } else {
    return [];
  }
  return zones.map((z) => ({ id: z.id, name: z.name, cityName: z.city?.name ?? null }));
}

/** Cheap zone lookup for a scope — lets routes authorize BEFORE the heavy rollup. */
export async function scopeZoneId(scope: CommandScope): Promise<string | null> {
  if (scope.kind === "zone") return scope.id;
  if (scope.kind === "cluster") {
    const c = await prisma.cluster.findFirst({
      where: { id: scope.id, deletedAt: null },
      select: { zoneId: true },
    });
    return c?.zoneId ?? null;
  }
  const s = await prisma.settlement.findFirst({
    where: { id: scope.id, deletedAt: null },
    select: { cluster: { select: { zoneId: true } } },
  });
  return s?.cluster.zoneId ?? null;
}

/** Cheap zone lookup for a goal (facility → settlement → cluster → explicit zone, first hit wins). */
export async function goalZoneId(goalId: string): Promise<string | null> {
  const g = await prisma.goal.findFirst({
    where: { id: goalId, deletedAt: null },
    select: {
      needsZoneId: true,
      needsCluster: { select: { zoneId: true } },
      needsSettlement: { select: { cluster: { select: { zoneId: true } } } },
      linkedFacility: { select: { zoneId: true, cluster: { select: { zoneId: true } } } },
    },
  });
  if (!g) return null;
  return (
    g.linkedFacility?.zoneId ??
    g.linkedFacility?.cluster?.zoneId ??
    g.needsSettlement?.cluster.zoneId ??
    g.needsCluster?.zoneId ??
    g.needsZoneId ??
    null
  );
}

// ── Row types ────────────────────────────────────────────────────────────────

export type CommandFront = {
  pitstopId: string;
  title: string;
  workstream: string;
  onCriticalPath: boolean;
  /** Days this step has been the open front (from predecessors' completion / its start). Heuristic — render as "~N days". */
  daysStuck: number;
  /** Days past the step's own targetDate (0 when none / not yet due). */
  daysOverdue: number;
};

export type CommandWorkstream = { tag: string; done: number; total: number; blocked: boolean };

export type CommandSetup = {
  step: number | null;
  totalSteps: number | null;
  front: CommandFront | null;
  /** Setup pitstops currently blocked by an unmet dependency. */
  blocked: number;
  /** Non-Done setup activities scheduled before the anchor month (month-based overdue). */
  overdueActivities: number;
  workstreams: CommandWorkstream[];
  targetDate: string | null;
};

export type CommandLive = {
  cadence: { done: number; required: number };
  /** Oldest→newest, ending at the anchor month. Past months use the CURRENT cadence (history isn't stored). */
  monthly: { ym: string; done: number; required: number }[];
  lastVisitAt: string | null;
};

export type CommandIndicator = {
  defId: string;
  key: string;
  label: string;
  unit: string | null;
  value: number | null;
  target: number | null;
  /** Latest value captured before the anchor month (delta basis). */
  prevValue: number | null;
  lastCapturedAt: string | null;
  staleness: "green" | "yellow" | "red" | "none";
  /** Indicators live at settlement grain; >1 same-layer facilities share these numbers. */
  grain: "settlement";
  sharedFacilityCount: number;
};

export type CommandRow = {
  goalId: string;
  facilityId: string | null;
  /** Display name: linked facility name, else goal title (centres.ts convention). */
  name: string;
  mode: string;
  themeKey: string;
  themeLabel: string;
  themeColor: string;
  clusterId: string | null;
  clusterName: string | null;
  settlementId: string | null;
  settlementName: string | null;
  rp: { id: string; name: string | null } | null;
  phase: CentrePhase;
  setup: CommandSetup | null;
  live: CommandLive | null;
  aps: { open: number; overdue: number; maxAgeDays: number; oldestDue: string | null };
  indicators: CommandIndicator[];
};

export type CommandRollup = {
  scope: {
    kind: CommandScope["kind"];
    id: string;
    name: string;
    cityName: string | null;
    zone: { id: string; name: string } | null;
    clusters: { id: string; name: string }[];
    settlements: { id: string; name: string; clusterId: string }[];
  };
  themes: ThemeDef[];
  /** Months covered by every live row's `monthly` array (oldest→newest). */
  months: string[];
  rows: CommandRow[];
  generatedAt: string;
};

// ── Loader ───────────────────────────────────────────────────────────────────

const MONTHLY_WINDOW = 6;
const INDICATORS_PER_DOMAIN = 4;
const DAY_MS = 86_400_000;

type GeoScope = NonNullable<Awaited<ReturnType<typeof resolveGeo>>>;

async function resolveGeo(scope: CommandScope) {
  const settlementSelect = { id: true, name: true, clusterId: true } as const;
  if (scope.kind === "zone") {
    const zone = await prisma.zone.findFirst({
      where: { id: scope.id, deletedAt: null },
      select: {
        id: true,
        name: true,
        city: { select: { name: true } },
        clusters: {
          where: { deletedAt: null },
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            settlements: { where: { deletedAt: null }, select: settlementSelect },
          },
        },
      },
    });
    if (!zone) return null;
    return {
      kind: scope.kind,
      id: zone.id,
      name: zone.name,
      cityName: zone.city?.name ?? null,
      zone: { id: zone.id, name: zone.name },
      clusters: zone.clusters.map((c) => ({ id: c.id, name: c.name })),
      settlements: zone.clusters.flatMap((c) => c.settlements),
    };
  }
  if (scope.kind === "cluster") {
    const cluster = await prisma.cluster.findFirst({
      where: { id: scope.id, deletedAt: null },
      select: {
        id: true,
        name: true,
        zone: { select: { id: true, name: true, city: { select: { name: true } } } },
        settlements: { where: { deletedAt: null }, select: settlementSelect },
      },
    });
    if (!cluster) return null;
    return {
      kind: scope.kind,
      id: cluster.id,
      name: cluster.name,
      cityName: cluster.zone.city?.name ?? null,
      zone: { id: cluster.zone.id, name: cluster.zone.name },
      clusters: [{ id: cluster.id, name: cluster.name }],
      settlements: cluster.settlements,
    };
  }
  const settlement = await prisma.settlement.findFirst({
    where: { id: scope.id, deletedAt: null },
    select: {
      id: true,
      name: true,
      clusterId: true,
      cluster: { select: { id: true, name: true, zone: { select: { id: true, name: true, city: { select: { name: true } } } } } },
    },
  });
  if (!settlement) return null;
  return {
    kind: scope.kind,
    id: settlement.id,
    name: settlement.name,
    cityName: settlement.cluster.zone.city?.name ?? null,
    zone: { id: settlement.cluster.zone.id, name: settlement.cluster.zone.name },
    clusters: [{ id: settlement.cluster.id, name: settlement.cluster.name }],
    settlements: [{ id: settlement.id, name: settlement.name, clusterId: settlement.clusterId }],
  };
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function getStaleness(
  last: Date | null,
  yellowDays: number,
  redDays: number,
  now: Date,
): CommandIndicator["staleness"] {
  if (!last) return "none";
  const daysSince = Math.floor((now.getTime() - last.getTime()) / DAY_MS);
  if (daysSince >= redDays) return "red";
  if (daysSince >= yellowDays) return "yellow";
  return "green";
}

/**
 * Load the full operational rollup for a geography. `opts.now` shifts the
 * anchor month (pass mid-month of the requested month for a historical view).
 */
export async function loadCommandRollup(
  scope: CommandScope,
  opts: { now?: Date } = {},
): Promise<CommandRollup | null> {
  const now = opts.now ?? new Date();
  const geo = await resolveGeo(scope);
  if (!geo) return null;

  const anchor = monthBounds(now);
  const windowStart = new Date(now.getFullYear(), now.getMonth() - (MONTHLY_WINDOW - 1), 1, 0, 0, 0, 0);
  const months: string[] = Array.from({ length: MONTHLY_WINDOW }, (_, i) =>
    ymKey(new Date(now.getFullYear(), now.getMonth() - (MONTHLY_WINDOW - 1) + i, 15)),
  );

  const [goals, themeCatalog] = await Promise.all([
    prisma.goal.findMany({
      where: {
        AND: [
          { deletedAt: null, status: { not: "Complete" } },
          goalInScopeFilter(scope),
        ],
      },
      select: {
        id: true,
        title: true,
        mode: true,
        needsDomain: true,
        targetDate: true,
        createdAt: true,
        owner: { select: { id: true, name: true } },
        needsCluster: { select: { id: true, name: true } },
        needsSettlement: { select: { id: true, name: true, cluster: { select: { id: true, name: true } } } },
        linkedFacility: {
          select: {
            id: true,
            name: true,
            layerKey: true,
            settlement: { select: { id: true, name: true } },
            cluster: { select: { id: true, name: true } },
          },
        },
        centreCatalog: { select: { cadenceCount: true, cadencePeriod: true } },
        pitstops: {
          where: { deletedAt: null },
          select: {
            id: true,
            status: true,
            recurrence: true,
            order: true,
            progressTag: true,
            title: true,
            isMilestone: true,
            startDate: true,
            targetDate: true,
            completedAt: true,
            blockedBy: { select: { blockedById: true } },
          },
        },
      },
    }),
    loadThemeCatalog(),
  ]);

  const themesByKey = indexThemes(themeCatalog);
  // layerKey → domain, derived from the theme catalog we already loaded — avoids
  // a redundant facilityLayerConfig round-trip (loadLayerToDomain queries it again).
  const layerToDomain = new Map<string, string>();
  for (const t of themeCatalog) if (t.layerKey) layerToDomain.set(t.layerKey, t.key);

  // Decorate with theme; drop goals that resolve to no programme domain
  // (general project goals are out of scope for the command center).
  const themed = goals
    .map((g) => ({ g, themeKey: resolveGoalThemeKey(g, layerToDomain) }))
    .filter((x): x is { g: (typeof goals)[number]; themeKey: string } => !!x.themeKey && themesByKey.has(x.themeKey!));

  if (themed.length === 0) {
    return {
      scope: geo,
      themes: themeCatalog,
      months,
      rows: [],
      generatedAt: new Date().toISOString(),
    };
  }

  const goalIds = themed.map((x) => x.g.id);
  const liveGoalIds = themed.filter((x) => x.g.mode === "live").map((x) => x.g.id);

  // Pitstop → goal map for the setup-activity overdue aggregation.
  const pitstopToGoal = new Map<string, string>();
  for (const { g } of themed) for (const p of g.pitstops) pitstopToGoal.set(p.id, g.id);
  const pitstopIds = [...pitstopToGoal.keys()];

  const todayStart = startOfLocalDay(now);

  // Everything derivable from the goals+catalog (no further DB) — computed up
  // front so the indicator-def and facility-count queries can join the same
  // parallel wave rather than waiting for it.
  const domainsInScope = [...new Set(themed.map((x) => x.themeKey))];
  const rowSettlementIds = [
    ...new Set(
      themed
        .map((x) => x.g.linkedFacility?.settlement?.id ?? x.g.needsSettlement?.id ?? null)
        .filter((id): id is string => !!id),
    ),
  ];

  const [visitStats, setupEvents, apOpen, apOverdue, defs, facilityCounts] = await Promise.all([
    visitStatsByGoal(liveGoalIds, windowStart, anchor.end),
    // Non-Done setup activities scheduled before the anchor month — the
    // month-based overdue convention from centres.ts (an RP has the whole
    // month; work is overdue only once its month has fully passed).
    pitstopIds.length > 0
      ? prisma.pitstopEvent.findMany({
          where: {
            deletedAt: null,
            status: { notIn: ["Cancelled", "Done"] },
            scheduledAt: { lt: anchor.start },
            pitstops: { some: { pitstopId: { in: pitstopIds } } },
          },
          select: { pitstops: { select: { pitstopId: true } } },
        })
      : Promise.resolve([]),
    prisma.actionPoint.groupBy({
      by: ["goalId"],
      where: { goalId: { in: goalIds }, status: "open" },
      _count: { _all: true },
      _min: { dueDate: true },
    }),
    prisma.actionPoint.groupBy({
      by: ["goalId"],
      where: { goalId: { in: goalIds }, status: "open", dueDate: { lt: todayStart } },
      _count: { _all: true },
    }),
    prisma.facilityIndicatorDef.findMany({
      where: { isActive: true, domain: { in: domainsInScope } },
      orderBy: [{ sortOrder: "asc" }],
      select: {
        id: true,
        key: true,
        label: true,
        unit: true,
        domain: true,
        facilityLayerKey: true,
        staleYellowDays: true,
        staleRedDays: true,
      },
    }),
    rowSettlementIds.length > 0
      ? prisma.layerFeature.groupBy({
          by: ["settlementId", "layerKey"],
          where: { settlementId: { in: rowSettlementIds } },
          _count: { id: true },
        })
      : Promise.resolve([]),
  ]);

  const overdueActivitiesByGoal = new Map<string, number>();
  for (const e of setupEvents) {
    const gids = new Set<string>();
    for (const link of e.pitstops) {
      const gid = pitstopToGoal.get(link.pitstopId);
      if (gid) gids.add(gid);
    }
    for (const gid of gids) overdueActivitiesByGoal.set(gid, (overdueActivitiesByGoal.get(gid) ?? 0) + 1);
  }

  const apByGoal = new Map(apOpen.map((r) => [r.goalId, { open: r._count._all, oldestDue: r._min.dueDate }]));
  const apOverdueByGoal = new Map(apOverdue.map((r) => [r.goalId, r._count._all]));

  // ── Indicators (settlement grain) ─────────────────────────────────────────
  // Top-K per domain by sortOrder (admin-controlled highlight order).
  const defsByDomain = new Map<string, typeof defs>();
  for (const d of defs) {
    const list = defsByDomain.get(d.domain) ?? [];
    if (list.length < INDICATORS_PER_DOMAIN) list.push(d);
    defsByDomain.set(d.domain, list);
  }
  const keptDefIds = [...defsByDomain.values()].flat().map((d) => d.id);

  const instances =
    keptDefIds.length > 0 && rowSettlementIds.length > 0
      ? await prisma.facilityIndicator.findMany({
          where: { defId: { in: keptDefIds }, settlementId: { in: rowSettlementIds } },
          select: {
            id: true,
            defId: true,
            settlementId: true,
            currentValue: true,
            targetValue: true,
            lastCapturedAt: true,
          },
        })
      : [];

  // Latest point strictly before the anchor month, per indicator instance → delta basis.
  const prevPoints =
    instances.length > 0
      ? await prisma.facilityIndicatorPoint.findMany({
          where: { indicatorId: { in: instances.map((i) => i.id) }, capturedAt: { lt: anchor.start } },
          orderBy: { capturedAt: "desc" },
          distinct: ["indicatorId"],
          select: { indicatorId: true, value: true },
        })
      : [];
  const prevByInstance = new Map(prevPoints.map((p) => [p.indicatorId, p.value]));

  const instanceByDefSettlement = new Map(instances.map((i) => [`${i.defId}:${i.settlementId}`, i]));
  const facilityCountByKey = new Map(
    facilityCounts
      .filter((f) => f.settlementId)
      .map((f) => [`${f.settlementId}:${f.layerKey}`, f._count.id]),
  );

  // ── Assemble rows ─────────────────────────────────────────────────────────
  const rows: CommandRow[] = themed.map(({ g, themeKey }) => {
    const theme = themesByKey.get(themeKey)!;
    const isLive = g.mode === "live";

    const cluster = g.linkedFacility?.cluster ?? g.needsSettlement?.cluster ?? g.needsCluster ?? null;
    const settlement = g.linkedFacility?.settlement ?? g.needsSettlement ?? null;

    const phase = deriveCentrePhase(g.pitstops as PhasePitstop[], { mode: g.mode });

    // ── Setup facet ──
    let setup: CommandSetup | null = null;
    if (!isLive) {
      const setupPitstops = g.pitstops
        .filter((p) => p.recurrence === "None")
        .sort((a, b) => a.order - b.order);
      const setupIds = new Set(setupPitstops.map((p) => p.id));
      const doneById = new Map(setupPitstops.map((p) => [p.id, p.status === "Done"]));

      const cpNodes: CpNode[] = setupPitstops.map((p) => ({
        id: p.id,
        blockedBy: p.blockedBy.map((d) => d.blockedById).filter((id) => setupIds.has(id)),
        done: p.status === "Done",
      }));
      const milestoneIds = setupPitstops.filter((p) => p.isMilestone).map((p) => p.id);
      const { path, frontId } = computeCriticalPath(cpNodes, milestoneIds);

      const blockedCount = setupPitstops.filter(
        (p) =>
          p.status !== "Done" &&
          p.blockedBy.some((d) => setupIds.has(d.blockedById) && !doneById.get(d.blockedById)),
      ).length;

      let front: CommandFront | null = null;
      const frontPitstop = frontId ? setupPitstops.find((p) => p.id === frontId) ?? null : null;
      if (frontPitstop) {
        // Anchor for "how long stuck here": latest predecessor completion,
        // else the step's own startDate, else goal creation.
        const predCompleted = frontPitstop.blockedBy
          .map((d) => setupPitstops.find((p) => p.id === d.blockedById)?.completedAt ?? null)
          .filter((d): d is Date => !!d);
        const stuckAnchor =
          predCompleted.length > 0
            ? new Date(Math.max(...predCompleted.map((d) => d.getTime())))
            : frontPitstop.startDate ?? g.createdAt;
        const daysStuck = Math.max(0, Math.floor((now.getTime() - stuckAnchor.getTime()) / DAY_MS));
        const due = frontPitstop.targetDate ? startOfLocalDay(frontPitstop.targetDate) : null;
        const daysOverdue = due && due < todayStart ? Math.round((todayStart.getTime() - due.getTime()) / DAY_MS) : 0;
        front = {
          pitstopId: frontPitstop.id,
          title: frontPitstop.title,
          workstream: frontPitstop.progressTag || "Ungrouped",
          onCriticalPath: path.has(frontPitstop.id),
          daysStuck,
          daysOverdue,
        };
      }

      const tags = orderProgressTags(setupPitstops.map((p) => p.progressTag || "Ungrouped"));
      const workstreams: CommandWorkstream[] = tags.map((tag) => {
        const nodes = setupPitstops.filter((p) => (p.progressTag || "Ungrouped") === tag);
        return {
          tag,
          done: nodes.filter((p) => p.status === "Done").length,
          total: nodes.length,
          blocked: nodes.some(
            (p) =>
              p.status !== "Done" &&
              p.blockedBy.some((d) => setupIds.has(d.blockedById) && !doneById.get(d.blockedById)),
          ),
        };
      });

      setup = {
        step: phase.currentStep,
        totalSteps: phase.totalSteps,
        front,
        blocked: blockedCount,
        overdueActivities: overdueActivitiesByGoal.get(g.id) ?? 0,
        workstreams,
        targetDate: g.targetDate ? g.targetDate.toISOString() : null,
      };
    }

    // ── Live facet ──
    let live: CommandLive | null = null;
    if (isLive) {
      const cadence = resolveCadence(g.centreCatalog, null);
      const stats = visitStats.get(g.id);
      const monthly = months.map((ym, i) => {
        const monthDate = new Date(now.getFullYear(), now.getMonth() - (MONTHLY_WINDOW - 1) + i, 15);
        return {
          ym,
          done: stats?.byMonth.get(ym) ?? 0,
          required: requiredVisitsForMonth(cadence, monthDate),
        };
      });
      live = {
        cadence: monthly[monthly.length - 1]
          ? { done: monthly[monthly.length - 1].done, required: monthly[monthly.length - 1].required }
          : { done: 0, required: 0 },
        monthly,
        lastVisitAt: stats?.lastVisitAt ? stats.lastVisitAt.toISOString() : null,
      };
    }

    // ── Follow-ups ──
    const ap = apByGoal.get(g.id);
    const oldestDue = ap?.oldestDue ?? null;
    const aps = {
      open: ap?.open ?? 0,
      overdue: apOverdueByGoal.get(g.id) ?? 0,
      maxAgeDays: oldestDue ? Math.max(0, Math.ceil((now.getTime() - oldestDue.getTime()) / DAY_MS)) : 0,
      oldestDue: oldestDue ? oldestDue.toISOString() : null,
    };

    // ── Indicators (via the row's settlement) ──
    const indicators: CommandIndicator[] = [];
    const sid = settlement?.id ?? null;
    if (sid) {
      for (const def of defsByDomain.get(themeKey) ?? []) {
        const inst = instanceByDefSettlement.get(`${def.id}:${sid}`);
        const layerKey = def.facilityLayerKey ?? theme.layerKey;
        indicators.push({
          defId: def.id,
          key: def.key,
          label: def.label,
          unit: def.unit,
          value: inst?.currentValue ?? null,
          target: inst?.targetValue ?? null,
          prevValue: inst ? prevByInstance.get(inst.id) ?? null : null,
          lastCapturedAt: inst?.lastCapturedAt ? inst.lastCapturedAt.toISOString() : null,
          staleness: getStaleness(inst?.lastCapturedAt ?? null, def.staleYellowDays, def.staleRedDays, now),
          grain: "settlement",
          sharedFacilityCount: layerKey ? facilityCountByKey.get(`${sid}:${layerKey}`) ?? 1 : 1,
        });
      }
    }

    return {
      goalId: g.id,
      facilityId: g.linkedFacility?.id ?? null,
      name: g.linkedFacility?.name ?? g.title,
      mode: g.mode,
      themeKey,
      themeLabel: theme.label,
      themeColor: theme.color,
      clusterId: cluster?.id ?? null,
      clusterName: cluster?.name ?? null,
      settlementId: settlement?.id ?? null,
      settlementName: settlement?.name ?? null,
      rp: g.owner ? { id: g.owner.id, name: g.owner.name } : null,
      phase,
      setup,
      live,
      aps,
      indicators,
    };
  });

  // Setting-up first, then live, then done; alphabetical within (centres.ts order).
  const rank = (r: CommandRow) =>
    r.phase.lifecycle === "setting_up" ? 0 : r.phase.lifecycle === "live" ? 1 : 2;
  rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  return {
    scope: geo,
    themes: themeCatalog,
    months,
    rows,
    generatedAt: new Date().toISOString(),
  };
}

export type { GeoScope };
