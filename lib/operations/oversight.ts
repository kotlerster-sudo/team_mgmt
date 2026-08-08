/**
 * Supervisory oversight tree — the geography-first drill-down for ZL / PM / Leader.
 *
 * Where the RP home is self-scoped and theme-first, a supervisor wants "where are things"
 * across the people they oversee: Zone → Cluster (live vs setting-up) → RP → Centre →
 * (activity, via the shared CentreDetail leaf). The visible-user set comes from
 * `getVisibleUserIds` (ZL/PM one-hop, Leader/admin recursive); everything below reuses the
 * same primitives the RP home uses (ownership predicate, phase derivation, theme catalog,
 * scheduled-vs-overdue event counting) so the numbers reconcile with the RP view.
 */

import prisma from "@/lib/prisma";
import { goalOwnedByAnyOf } from "@/lib/ownership";
import { slugifyChecklistText } from "@/lib/templateDb";
import { deriveCentrePhase, type PhasePitstop } from "./phase";
import { goalInClusterFilter } from "./clusters";
import { loadThemeCatalog, loadLayerToDomain, resolveGoalThemeKey, indexThemes } from "./themes";
import { monthBounds, requiredVisitsForMonth, doneVisitsByGoal } from "./month";
import { resolveCadence, type CatalogCategory, type CentreCatalogOverrides } from "@/lib/catalogDb";

export type OversightCentre = {
  goalId: string;
  title: string;
  themeKey: string;
  themeLabel: string;
  themeColor: string;
  lifecycle: "setting_up" | "live" | "done";
  today: number;
  overdue: number;
};

type Rollup = { live: number; settingUp: number; done: number; today: number; overdue: number };

export type OversightRp = Rollup & {
  id: string;
  name: string | null;
  centres: OversightCentre[];
};

export type OversightCluster = Rollup & {
  id: string;
  name: string;
  rps: OversightRp[];
};

export type OversightZone = Rollup & {
  id: string;
  name: string;
  clusters: OversightCluster[];
};

export type OversightTree = {
  zones: OversightZone[];
  totals: Rollup & { centres: number; rps: number };
};

const UNASSIGNED = "__unassigned";

function emptyRollup(): Rollup {
  return { live: 0, settingUp: 0, done: 0, today: 0, overdue: 0 };
}

function addCentre(r: Rollup, c: OversightCentre) {
  if (c.lifecycle === "live") r.live += 1;
  else if (c.lifecycle === "setting_up") r.settingUp += 1;
  else r.done += 1;
  r.today += c.today;
  r.overdue += c.overdue;
}

/**
 * Builds the full oversight tree for the given (already-resolved) visible user set.
 * Centres are attributed to the visible owner/co-owner; those without a cluster fall into
 * a synthetic "Unassigned" node so nothing silently disappears.
 */
export async function loadOversightTree(
  userIds: string[],
  opts: { now?: Date } = {},
): Promise<OversightTree> {
  const now = opts.now ?? new Date();
  const visible = new Set(userIds);

  const [catalog, layerToDomain, goals] = await Promise.all([
    loadThemeCatalog(),
    loadLayerToDomain(),
    prisma.goal.findMany({
      where: { AND: [goalOwnedByAnyOf(userIds), { deletedAt: null, status: { not: "Complete" } }] },
      select: {
        id: true,
        title: true,
        mode: true,
        needsDomain: true,
        ownerId: true,
        owner: { select: { id: true, name: true } },
        linkedFacility: { select: { layerKey: true, cluster: { select: { id: true, name: true, zone: { select: { id: true, name: true } } } } } },
        needsCluster: { select: { id: true, name: true, zone: { select: { id: true, name: true } } } },
        needsSettlement: {
          select: { cluster: { select: { id: true, name: true, zone: { select: { id: true, name: true } } } } },
        },
        pitstops: {
          where: { deletedAt: null },
          select: { id: true, status: true, recurrence: true, order: true, progressTag: true, title: true },
        },
        coOwners: { select: { user: { select: { id: true, name: true } } } },
      },
    }),
  ]);

  // Today + overdue event counts per goal — same scheduledAt/month rules as the RP home.
  const { todayByGoal, overdueByGoal } = await countEventsPerGoal(goals, now);

  const themeIndex = indexThemes(catalog);

  // zoneId → { zone, clusterId → { cluster, rpId → OversightRp } }
  type ZoneAcc = { id: string; name: string; clusters: Map<string, ClusterAcc> };
  type ClusterAcc = { id: string; name: string; rps: Map<string, OversightRp> };
  const zones = new Map<string, ZoneAcc>();
  const rpSeen = new Set<string>();
  let centreCount = 0;

  for (const g of goals) {
    // Attribute to the visible owner, else the first visible co-owner.
    let rp: { id: string; name: string | null } | null =
      g.owner && visible.has(g.owner.id) ? g.owner : null;
    if (!rp) rp = g.coOwners.map((c) => c.user).find((u) => visible.has(u.id)) ?? g.owner ?? null;
    const rpId = rp?.id ?? UNASSIGNED;

    const cl = g.needsCluster ?? g.needsSettlement?.cluster ?? g.linkedFacility?.cluster ?? null;
    const zoneId = cl?.zone?.id ?? UNASSIGNED;
    const zoneName = cl?.zone?.name ?? "Unassigned";
    const clusterId = cl?.id ?? UNASSIGNED;
    const clusterName = cl?.name ?? "Unassigned";

    const themeKey = resolveGoalThemeKey(g, layerToDomain) ?? "__other";
    const theme = themeIndex.get(themeKey);
    const phase = deriveCentrePhase(g.pitstops as PhasePitstop[], { mode: g.mode });

    const centre: OversightCentre = {
      goalId: g.id,
      title: g.title,
      themeKey,
      themeLabel: theme?.label ?? "Other",
      themeColor: theme?.color ?? "#6b7280",
      lifecycle: phase.lifecycle,
      today: todayByGoal.get(g.id) ?? 0,
      overdue: overdueByGoal.get(g.id) ?? 0,
    };
    centreCount += 1;

    let zone = zones.get(zoneId);
    if (!zone) { zone = { id: zoneId, name: zoneName, clusters: new Map() }; zones.set(zoneId, zone); }
    let cluster = zone.clusters.get(clusterId);
    if (!cluster) { cluster = { id: clusterId, name: clusterName, rps: new Map() }; zone.clusters.set(clusterId, cluster); }
    let rpNode = cluster.rps.get(rpId);
    if (!rpNode) {
      rpNode = { id: rpId, name: rp?.name ?? "Unassigned", centres: [], ...emptyRollup() };
      cluster.rps.set(rpId, rpNode);
    }
    rpNode.centres.push(centre);
    rpSeen.add(rpId);
  }

  // Materialise + roll up bottom-up, sorted for stable presentation.
  const totals = { ...emptyRollup(), centres: centreCount, rps: rpSeen.size };
  const byName = (a: { name: string | null }, b: { name: string | null }) =>
    (a.name ?? "~").localeCompare(b.name ?? "~");
  const centreSort = (a: OversightCentre, b: OversightCentre) =>
    b.overdue - a.overdue || b.today - a.today || a.title.localeCompare(b.title);

  const zoneList: OversightZone[] = [];
  for (const z of zones.values()) {
    const clusterList: OversightCluster[] = [];
    for (const c of z.clusters.values()) {
      const rpList: OversightRp[] = [];
      for (const rp of c.rps.values()) {
        rp.centres.sort(centreSort);
        for (const centre of rp.centres) { addCentre(rp, centre); addCentre(totals, centre); }
        rpList.push(rp);
      }
      rpList.sort(byName);
      const cluster: OversightCluster = { id: c.id, name: c.name, rps: rpList, ...emptyRollup() };
      for (const rp of rpList) mergeRollup(cluster, rp);
      clusterList.push(cluster);
    }
    // Live clusters (any live centre) before pure setting-up; then by name.
    clusterList.sort((a, b) => Number(b.live > 0) - Number(a.live > 0) || a.name.localeCompare(b.name));
    const zone: OversightZone = { id: z.id, name: z.name, clusters: clusterList, ...emptyRollup() };
    for (const cl of clusterList) mergeRollup(zone, cl);
    zoneList.push(zone);
  }
  zoneList.sort((a, b) => a.name.localeCompare(b.name));

  return { zones: zoneList, totals };
}

// ── Cluster → centres list (each centre carries its own activity counts) ──────

export type BoardCentre = {
  goalId: string;
  name: string;
  themeKey: string;
  ownerName: string | null;
  mode: string;
  /** Setup centre whose domain has an authored catalog → can be taken live. */
  canGoLive: boolean;
  today: number;
  overdue: number;
  upcoming: number;
  followUps: number;
};

export type ClusterBoard = {
  clusterId: string;
  clusterName: string;
  centres: BoardCentre[];
};

/**
 * The centres/programmes in one cluster across the supervised set, each with its own activity
 * counts (today / overdue / upcoming / open follow-ups) so a supervisor drills Cluster → Centre
 * → (per-centre) sections rather than a flat cluster-wide activity dump. Same scheduledAt/month
 * rules as the RP home; only top-level events (visitEventId null).
 */
export async function loadClusterBoard(
  userIds: string[],
  clusterId: string,
  now: Date = new Date(),
): Promise<ClusterBoard | null> {
  const cluster = await prisma.cluster.findUnique({ where: { id: clusterId }, select: { name: true } });
  if (!cluster) return null;

  const [layerToDomain, catalogDomainRows, goals] = await Promise.all([
    loadLayerToDomain(),
    prisma.catalogTemplateDef.findMany({ where: { isActive: true, needsDomain: { not: null } }, select: { needsDomain: true } }),
    prisma.goal.findMany({
      where: {
        AND: [
          goalOwnedByAnyOf(userIds),
          goalInClusterFilter(clusterId),
          { deletedAt: null, status: { not: "Complete" } },
        ],
      },
      select: {
        id: true, title: true, needsDomain: true, mode: true,
        owner: { select: { name: true } },
        linkedFacility: { select: { name: true, layerKey: true } },
        pitstops: { where: { deletedAt: null }, select: { id: true } },
      },
    }),
  ]);
  const domainsWithCatalog = new Set(catalogDomainRows.map((r) => r.needsDomain).filter(Boolean) as string[]);

  const pitstopToGoal = new Map<string, string>();
  const centreByGoal = new Map<string, BoardCentre>();
  for (const g of goals) {
    for (const p of g.pitstops) pitstopToGoal.set(p.id, g.id);
    centreByGoal.set(g.id, {
      goalId: g.id,
      name: g.linkedFacility?.name ?? g.title,
      themeKey: resolveGoalThemeKey(g, layerToDomain) ?? "__other",
      ownerName: g.owner?.name ?? null,
      mode: g.mode,
      canGoLive: g.mode !== "live" && !!g.needsDomain && domainsWithCatalog.has(g.needsDomain),
      today: 0, overdue: 0, upcoming: 0, followUps: 0,
    });
  }
  const goalIds = [...centreByGoal.keys()];
  const pitstopIds = [...pitstopToGoal.keys()];

  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const horizonEnd = new Date(now); horizonEnd.setDate(horizonEnd.getDate() + 60); horizonEnd.setHours(23, 59, 59, 999);

  if (pitstopIds.length > 0) {
    const events = await prisma.pitstopEvent.findMany({
      where: {
        deletedAt: null,
        visitEventId: null, // top-level activities/visits only
        status: { notIn: ["Done", "Cancelled"] },
        scheduledAt: { lte: horizonEnd },
        pitstops: { some: { pitstopId: { in: pitstopIds } } },
      },
      select: { scheduledAt: true, pitstops: { select: { pitstopId: true } } },
      take: 2000,
    });
    for (const e of events) {
      let goalId: string | undefined;
      for (const link of e.pitstops) { const gid = pitstopToGoal.get(link.pitstopId); if (gid) { goalId = gid; break; } }
      if (!goalId) continue;
      const c = centreByGoal.get(goalId)!;
      if (e.scheduledAt >= todayStart && e.scheduledAt <= todayEnd) c.today += 1;
      else if (e.scheduledAt < monthStart) c.overdue += 1;
      else if (e.scheduledAt > todayEnd) c.upcoming += 1;
    }
  }

  if (goalIds.length > 0) {
    const aps = await prisma.actionPoint.groupBy({
      by: ["goalId"], where: { status: "open", goalId: { in: goalIds } }, _count: true,
    });
    for (const a of aps) { const c = a.goalId ? centreByGoal.get(a.goalId) : null; if (c) c.followUps = a._count; }
  }

  // Setting-up before live; then by attention (overdue+today), then name.
  const centres = [...centreByGoal.values()].sort((a, b) =>
    Number(a.mode === "live") - Number(b.mode === "live") ||
    (b.overdue + b.today) - (a.overdue + a.today) ||
    a.name.localeCompare(b.name),
  );
  return { clusterId, clusterName: cluster.name, centres };
}

// ── Approval queues (supervisor review surfaces) ─────────────────────────────

export type PendingApproval = {
  id: string;
  goalId: string;
  goalTitle: string;
  clusterName: string | null;
  itemKey: string;
  itemText: string;
  addedByName: string | null;
  createdAt: string;
};

/**
 * Pending ad-hoc catalog items added by the caller's reports, oldest first. Filtered on
 * `addedById` (not goal ownership) so it mirrors the approve route: you review your reports'
 * additions, never your own — those go up to your supervisor.
 */
export async function loadPendingApprovals(reportIds: string[]): Promise<PendingApproval[]> {
  if (reportIds.length === 0) return [];
  const rows = await prisma.catalogItemApproval.findMany({
    where: { status: "pending", addedById: { in: reportIds } },
    select: {
      id: true, itemKey: true, createdAt: true,
      addedBy: { select: { name: true } },
      goal: {
        select: {
          id: true, title: true,
          needsCluster: { select: { name: true } },
          needsSettlement: { select: { cluster: { select: { name: true } } } },
          centreCatalog: { select: { snapshot: true, overrides: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((r) => ({
    id: r.id,
    goalId: r.goal.id,
    goalTitle: r.goal.title,
    clusterName: r.goal.needsCluster?.name ?? r.goal.needsSettlement?.cluster?.name ?? null,
    itemKey: r.itemKey,
    itemText: resolveItemText(r.goal.centreCatalog, r.itemKey),
    addedByName: r.addedBy?.name ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Look up an added item's display text from a centre's overrides/snapshot by key. */
function resolveItemText(
  centre: { snapshot: unknown; overrides: unknown } | null,
  itemKey: string,
): string {
  if (!centre) return itemKey;
  const snapshot = (centre.snapshot ?? []) as unknown as CatalogCategory[];
  const overrides = (centre.overrides ?? {}) as unknown as CentreCatalogOverrides;
  const candidates = [
    ...snapshot.flatMap((c) => c.items ?? []),
    ...(overrides.addedItems ?? []).map((a) => a.item),
    ...(overrides.addedCategories ?? []).flatMap((c) => c.items ?? []),
  ];
  const hit = candidates.find((i) => (i.key || slugifyChecklistText(i.text)) === itemKey);
  return hit?.text ?? itemKey;
}

function mergeRollup(target: Rollup, src: Rollup) {
  target.live += src.live;
  target.settingUp += src.settingUp;
  target.done += src.done;
  target.today += src.today;
  target.overdue += src.overdue;
}

// ── Cross-cluster health dashboard ───────────────────────────────────────────

export type ClusterStatus = "critical" | "attention" | "healthy";

export type ClusterHealth = {
  id: string;
  name: string;
  live: number;
  settingUp: number;
  today: number;
  overdue: number;
  /** Visit-cadence progress this month, summed across the cluster's live centres. */
  cadenceDone: number;
  cadenceRequired: number;
  pendingApprovals: number;
  status: ClusterStatus;
};

export type ZoneHealth = { id: string; name: string; clusters: ClusterHealth[] };

export type ClusterHealthDashboard = {
  zones: ZoneHealth[];
  totals: { clusters: number; live: number; settingUp: number; today: number; overdue: number; pendingApprovals: number };
};

// One place to tune "where a cluster stands". Cadence pct = done/required this month.
const HEALTH_THRESHOLDS = {
  criticalOverdue: 10,
  attentionOverdue: 3,
  criticalCadencePct: 0.4,
  attentionCadencePct: 0.7,
};

function deriveClusterStatus(c: {
  overdue: number; cadenceDone: number; cadenceRequired: number; pendingApprovals: number;
}): ClusterStatus {
  const pct = c.cadenceRequired > 0 ? c.cadenceDone / c.cadenceRequired : 1;
  if (c.overdue >= HEALTH_THRESHOLDS.criticalOverdue || pct < HEALTH_THRESHOLDS.criticalCadencePct) return "critical";
  if (
    c.overdue >= HEALTH_THRESHOLDS.attentionOverdue ||
    pct < HEALTH_THRESHOLDS.attentionCadencePct ||
    c.pendingApprovals > 0
  ) return "attention";
  return "healthy";
}

type ClusterRef = {
  needsCluster: { id: string } | null;
  needsSettlement: { cluster: { id: string } | null } | null;
  linkedFacility: { cluster: { id: string } | null } | null;
};
const clusterIdOf = (g: ClusterRef): string =>
  g.needsCluster?.id ?? g.needsSettlement?.cluster?.id ?? g.linkedFacility?.cluster?.id ?? UNASSIGNED;

/**
 * "Where does each cluster stand" for ZL / PM / Leader. Reuses the oversight tree for the
 * structural rollups (live / setting-up / today / overdue per cluster) and overlays two more
 * signals — this month's visit-cadence compliance (summed across live centres) and the pending
 * catalog-approval backlog — into one composite status. Same visible-user scoping as the tree.
 */
export async function loadClusterHealthDashboard(
  userIds: string[],
  reportIds: string[],
  now: Date = new Date(),
): Promise<ClusterHealthDashboard> {
  const [tree, liveGoals, approvals] = await Promise.all([
    loadOversightTree(userIds, { now }),
    prisma.goal.findMany({
      where: { AND: [goalOwnedByAnyOf(userIds), { deletedAt: null, mode: "live", status: { not: "Complete" } }] },
      select: {
        id: true,
        needsCluster: { select: { id: true } },
        needsSettlement: { select: { cluster: { select: { id: true } } } },
        linkedFacility: { select: { cluster: { select: { id: true } } } },
        centreCatalog: { select: { cadenceCount: true, cadencePeriod: true } },
      },
    }),
    reportIds.length
      ? prisma.catalogItemApproval.findMany({
          where: { status: "pending", addedById: { in: reportIds } },
          select: {
            goal: {
              select: {
                needsCluster: { select: { id: true } },
                needsSettlement: { select: { cluster: { select: { id: true } } } },
                linkedFacility: { select: { cluster: { select: { id: true } } } },
              },
            },
          },
        })
      : Promise.resolve([] as { goal: ClusterRef }[]),
  ]);

  // Cadence per cluster: required (from each live centre's cadence) vs done (this month's visits).
  const monthDoneByGoal = await doneVisitsByGoal(liveGoals.map((g) => g.id), monthBounds(now));
  const cadenceDone = new Map<string, number>();
  const cadenceReq = new Map<string, number>();
  for (const g of liveGoals) {
    const cid = clusterIdOf(g);
    const cadence = resolveCadence(g.centreCatalog, { defaultCadenceCount: null, defaultCadencePeriod: null });
    cadenceReq.set(cid, (cadenceReq.get(cid) ?? 0) + requiredVisitsForMonth(cadence, now));
    cadenceDone.set(cid, (cadenceDone.get(cid) ?? 0) + (monthDoneByGoal.get(g.id) ?? 0));
  }

  const approvalsByCluster = new Map<string, number>();
  for (const a of approvals) {
    const cid = clusterIdOf(a.goal);
    approvalsByCluster.set(cid, (approvalsByCluster.get(cid) ?? 0) + 1);
  }

  const totals = { clusters: 0, live: 0, settingUp: 0, today: 0, overdue: 0, pendingApprovals: 0 };
  const zones: ZoneHealth[] = tree.zones.map((z) => ({
    id: z.id,
    name: z.name,
    clusters: z.clusters.map((c) => {
      const cadenceDoneV = cadenceDone.get(c.id) ?? 0;
      const cadenceRequiredV = cadenceReq.get(c.id) ?? 0;
      const pendingApprovals = approvalsByCluster.get(c.id) ?? 0;
      const health: ClusterHealth = {
        id: c.id, name: c.name,
        live: c.live, settingUp: c.settingUp, today: c.today, overdue: c.overdue,
        cadenceDone: cadenceDoneV, cadenceRequired: cadenceRequiredV, pendingApprovals,
        status: deriveClusterStatus({ overdue: c.overdue, cadenceDone: cadenceDoneV, cadenceRequired: cadenceRequiredV, pendingApprovals }),
      };
      totals.clusters += 1;
      totals.live += health.live; totals.settingUp += health.settingUp;
      totals.today += health.today; totals.overdue += health.overdue;
      totals.pendingApprovals += health.pendingApprovals;
      return health;
    }),
  }));

  return { zones, totals };
}

/** Per-goal today + overdue event counts — mirrors loadOperationsHome's single-pass query. */
async function countEventsPerGoal(
  goals: { id: string; pitstops: { id: string }[] }[],
  now: Date,
): Promise<{ todayByGoal: Map<string, number>; overdueByGoal: Map<string, number> }> {
  const pitstopToGoal = new Map<string, string>();
  for (const g of goals) for (const p of g.pitstops) pitstopToGoal.set(p.id, g.id);
  const pitstopIds = [...pitstopToGoal.keys()];
  const todayByGoal = new Map<string, number>();
  const overdueByGoal = new Map<string, number>();
  if (pitstopIds.length === 0) return { todayByGoal, overdueByGoal };

  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const events = await prisma.pitstopEvent.findMany({
    where: {
      deletedAt: null,
      status: { not: "Cancelled" },
      scheduledAt: { lte: todayEnd },
      pitstops: { some: { pitstopId: { in: pitstopIds } } },
    },
    select: { status: true, scheduledAt: true, pitstops: { select: { pitstopId: true } } },
  });
  for (const e of events) {
    const goalIds = new Set<string>();
    for (const link of e.pitstops) { const gid = pitstopToGoal.get(link.pitstopId); if (gid) goalIds.add(gid); }
    const isToday = e.scheduledAt >= todayStart && e.scheduledAt <= todayEnd;
    const isOverdue = e.scheduledAt < monthStart && e.status !== "Done";
    for (const gid of goalIds) {
      if (isToday) todayByGoal.set(gid, (todayByGoal.get(gid) ?? 0) + 1);
      if (isOverdue) overdueByGoal.set(gid, (overdueByGoal.get(gid) ?? 0) + 1);
    }
  }
  return { todayByGoal, overdueByGoal };
}
