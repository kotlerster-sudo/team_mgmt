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
import { loadThemeCatalog, loadLayerToDomain, resolveGoalThemeKey, indexThemes } from "./themes";
import type { CatalogCategory, CentreCatalogOverrides } from "@/lib/catalogDb";

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
        linkedFacility: { select: { layerKey: true } },
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

    const cl = g.needsCluster ?? g.needsSettlement?.cluster ?? null;
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

export type OpenActionPoint = {
  id: string;
  title: string;
  detail: string | null;
  priority: string;
  dueDate: string | null;
  goalTitle: string;
  clusterName: string | null;
  ownerName: string | null;
};

/** Open action points (visit follow-ups) across the supervised scope, soonest-due first. */
export async function loadOpenActionPoints(userIds: string[]): Promise<OpenActionPoint[]> {
  const rows = await prisma.actionPoint.findMany({
    where: { status: "open", goal: goalOwnedByAnyOf(userIds) },
    select: {
      id: true, title: true, detail: true, priority: true, dueDate: true,
      owner: { select: { name: true } },
      goal: {
        select: {
          title: true,
          needsCluster: { select: { name: true } },
          needsSettlement: { select: { cluster: { select: { name: true } } } },
        },
      },
    },
    orderBy: { dueDate: "asc" },
  });

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    detail: r.detail,
    priority: r.priority,
    dueDate: r.dueDate ? r.dueDate.toISOString() : null,
    goalTitle: r.goal.title,
    clusterName: r.goal.needsCluster?.name ?? r.goal.needsSettlement?.cluster?.name ?? null,
    ownerName: r.owner?.name ?? null,
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
