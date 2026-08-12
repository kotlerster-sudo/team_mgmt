// Read path for the /field surface. Everything the three screens show is derived
// here from the new spine (FieldStep / FieldVisit / Goal) — no writes, no reads of
// the old Pitstop/CentreCatalog machinery.
import prisma from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { goalInClusterFilter } from "@/lib/operations/clusters";
import { monthBounds, requiredVisitsForMonth } from "@/lib/operations/month";
import { deriveFieldPhase, type FieldPhase } from "@/lib/field/phase";
import { activeFieldDomains } from "@/lib/field/access";

export type InterventionRow = {
  id: string;
  title: string;
  domain: string;
  domainLabel: string;
  phase: FieldPhase;
  locationName: string;
  // Setup progress
  setupDone: number;
  setupTotal: number;
  overdueSetup: number; // setup steps past due & not done
  overallSlaAt: Date | null; // anchor + overallSlaDays
  overallOverdue: boolean;
  // Live cadence (this calendar month)
  visitDone: number;
  visitRequired: number;
  behind: boolean; // live & visitDone < visitRequired
  // Follow-ups
  openFollowups: number;
  // Any attention flag (stuck): overdue setup, overall breach, behind on visits, or open overdue follow-up
  needsAttention: boolean;
};

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

const GOAL_INCLUDE = {
  fieldSteps: {
    where: { deletedAt: null },
    select: { kind: true, status: true, dueDate: true },
  },
  needsSettlement: { select: { name: true } },
  needsCluster: { select: { name: true } },
  linkedFacility: { select: { name: true, settlement: { select: { name: true } } } },
} satisfies Prisma.GoalInclude;

/** Load intervention rows for a user, optionally scoped to one cluster. */
export async function loadInterventions(userId: string, clusterId?: string): Promise<InterventionRow[]> {
  const domains = await activeFieldDomains();
  if (domains.size === 0) return [];

  const where: Prisma.GoalWhereInput = {
    deletedAt: null,
    needsDomain: { in: [...domains.keys()] },
    ...(clusterId ? goalInClusterFilter(clusterId) : {}),
  };
  const goals = await prisma.goal.findMany({ where, include: GOAL_INCLUDE });
  if (goals.length === 0) return [];

  const now = new Date();
  const { start, end } = monthBounds(now);
  const goalIds = goals.map((g) => g.id);

  // Cadence compliance: closed FieldVisits this month, per goal.
  const visitsThisMonth = await prisma.fieldVisit.groupBy({
    by: ["goalId"],
    where: { goalId: { in: goalIds }, closedAt: { gte: start, lte: end } },
    _count: { _all: true },
  });
  const doneByGoal = new Map(visitsThisMonth.map((v) => [v.goalId, v._count._all]));

  // Open follow-ups (ActionPoint) per goal.
  const followups = await prisma.actionPoint.groupBy({
    by: ["goalId"],
    where: { goalId: { in: goalIds }, status: "open" },
    _count: { _all: true },
  });
  const fuByGoal = new Map(followups.map((f) => [f.goalId, f._count._all]));

  return goals
    .map((g): InterventionRow => {
      const cfg = domains.get(g.needsDomain ?? "");
      const setup = g.fieldSteps.filter((s) => s.kind === "Setup");
      const setupTotal = setup.length;
      const setupDone = setup.filter((s) => s.status === "Done").length;
      const overdueSetup = setup.filter((s) => s.status !== "Done" && s.dueDate && s.dueDate < now).length;
      const hasVisitRecipe = g.fieldSteps.some((s) => s.kind === "Visit");
      const phase = deriveFieldPhase({ mode: g.mode, setupTotal, setupDone, hasVisitRecipe });

      const anchor = g.fieldAnchorAt ?? g.createdAt;
      const overallSlaAt = g.overallSlaDays != null ? addDays(anchor, g.overallSlaDays) : null;
      const overallOverdue = phase === "setting_up" && !!overallSlaAt && overallSlaAt < now;

      const cadence = g.cadenceCount ? { count: g.cadenceCount, period: (g.cadencePeriod as "week" | "month") ?? "month" } : cfg?.cadenceCount ? { count: cfg.cadenceCount, period: (cfg.cadencePeriod as "week" | "month") ?? "month" } : null;
      const visitRequired = phase === "live" ? requiredVisitsForMonth(cadence, now) : 0;
      const visitDone = doneByGoal.get(g.id) ?? 0;
      const behind = phase === "live" && visitDone < visitRequired;

      const openFollowups = fuByGoal.get(g.id) ?? 0;
      const locationName =
        g.needsSettlement?.name ?? g.linkedFacility?.settlement?.name ?? g.linkedFacility?.name ?? g.needsCluster?.name ?? "—";

      return {
        id: g.id,
        title: g.title,
        domain: g.needsDomain ?? "",
        domainLabel: cfg?.label ?? g.needsDomain ?? "",
        phase,
        locationName,
        setupDone,
        setupTotal,
        overdueSetup,
        overallSlaAt,
        overallOverdue,
        visitDone,
        visitRequired,
        behind,
        openFollowups,
        needsAttention: overdueSetup > 0 || overallOverdue || behind || openFollowups > 0,
      };
    })
    .sort((a, b) => Number(b.needsAttention) - Number(a.needsAttention) || a.title.localeCompare(b.title));
}

export type FormField = { key: string; label?: string; text?: string; type?: string; options?: string[] };
export type SetupStepView = {
  id: string;
  title: string;
  status: string;
  dueDate: Date | null;
  blocked: boolean;
  blockedByTitle: string | null;
  overdue: boolean;
  formKind: string | null;
  formSchema: unknown;
  answers: unknown;
};
export type VisitStepView = {
  id: string; // FieldStep(kind=Visit) recipe id
  title: string;
  mandatory: boolean;
  formKind: string | null;
  formSchema: unknown;
  // Per-current-visit state (null until a visit is open / this step ticked)
  done: boolean;
  answers: unknown;
};
export type FollowupView = {
  id: string;
  title: string;
  detail: string | null;
  dueDate: Date | null;
  priority: string;
};
export type InterventionDetail = {
  id: string;
  title: string;
  domainLabel: string;
  phase: FieldPhase;
  locationName: string;
  overallSlaAt: Date | null;
  overallOverdue: boolean;
  setupDone: number;
  setupTotal: number;
  setupSteps: SetupStepView[];
  // Live
  visitRequired: number;
  visitDoneThisMonth: number;
  openVisit: { id: string; arrivedAt: Date | null } | null;
  visitSteps: VisitStepView[];
  followups: FollowupView[];
};

/** Full detail for one intervention. Returns null if outside the active field domains. */
export async function loadIntervention(goalId: string): Promise<InterventionDetail | null> {
  const domains = await activeFieldDomains();
  const goal = await prisma.goal.findFirst({
    where: { id: goalId, deletedAt: null },
    include: {
      fieldSteps: { where: { deletedAt: null }, orderBy: { order: "asc" } },
      needsSettlement: { select: { name: true } },
      needsCluster: { select: { name: true } },
      linkedFacility: { select: { name: true, settlement: { select: { name: true } } } },
    },
  });
  if (!goal || !goal.needsDomain || !domains.has(goal.needsDomain)) return null;
  const cfg = domains.get(goal.needsDomain);
  const now = new Date();

  const setupRaw = goal.fieldSteps.filter((s) => s.kind === "Setup");
  const visitRecipe = goal.fieldSteps.filter((s) => s.kind === "Visit");
  const doneKeys = new Set(setupRaw.filter((s) => s.status === "Done").map((s) => s.stepKey));
  const titleByKey = new Map(setupRaw.map((s) => [s.stepKey, s.title]));

  const setupDone = setupRaw.filter((s) => s.status === "Done").length;
  const hasVisitRecipe = visitRecipe.length > 0;
  const phase = deriveFieldPhase({ mode: goal.mode, setupTotal: setupRaw.length, setupDone, hasVisitRecipe });

  const setupSteps: SetupStepView[] = setupRaw.map((s) => {
    const blocked = !!s.blockedByKey && !doneKeys.has(s.blockedByKey) && s.status !== "Done";
    return {
      id: s.id,
      title: s.title,
      status: s.status,
      dueDate: s.dueDate,
      blocked,
      blockedByTitle: s.blockedByKey ? titleByKey.get(s.blockedByKey) ?? null : null,
      overdue: s.status !== "Done" && !!s.dueDate && s.dueDate < now,
      formKind: s.formKind,
      formSchema: s.formSchema,
      answers: s.answers,
    };
  });

  const anchor = goal.fieldAnchorAt ?? goal.createdAt;
  const overallSlaAt = goal.overallSlaDays != null ? addDays(anchor, goal.overallSlaDays) : null;

  // Live cadence + open visit
  const { start, end } = monthBounds(now);
  const cadence = goal.cadenceCount ? { count: goal.cadenceCount, period: (goal.cadencePeriod as "week" | "month") ?? "month" } : cfg?.cadenceCount ? { count: cfg.cadenceCount, period: (cfg.cadencePeriod as "week" | "month") ?? "month" } : null;
  const visitRequired = phase === "live" ? requiredVisitsForMonth(cadence, now) : 0;
  const visitDoneThisMonth = phase === "live" ? await prisma.fieldVisit.count({ where: { goalId, closedAt: { gte: start, lte: end } } }) : 0;
  const openVisitRow = phase === "live" ? await prisma.fieldVisit.findFirst({ where: { goalId, closedAt: null }, orderBy: { createdAt: "desc" }, include: { steps: true } }) : null;
  const stepStateByStepId = new Map((openVisitRow?.steps ?? []).map((vs) => [vs.stepId, vs]));

  const visitSteps: VisitStepView[] = visitRecipe.map((s) => {
    const vs = stepStateByStepId.get(s.id);
    return {
      id: s.id,
      title: s.title,
      mandatory: s.mandatory,
      formKind: s.formKind,
      formSchema: s.formSchema,
      done: vs?.status === "Done",
      answers: vs?.answers ?? null,
    };
  });

  const followups = await prisma.actionPoint.findMany({
    where: { goalId, status: "open" },
    orderBy: [{ dueDate: "asc" }],
    select: { id: true, title: true, detail: true, dueDate: true, priority: true },
  });

  return {
    id: goal.id,
    title: goal.title,
    domainLabel: cfg?.label ?? goal.needsDomain,
    phase,
    locationName: goal.needsSettlement?.name ?? goal.linkedFacility?.settlement?.name ?? goal.linkedFacility?.name ?? goal.needsCluster?.name ?? "—",
    overallSlaAt,
    overallOverdue: phase === "setting_up" && !!overallSlaAt && overallSlaAt < now,
    setupDone,
    setupTotal: setupRaw.length,
    setupSteps,
    visitRequired,
    visitDoneThisMonth,
    openVisit: openVisitRow ? { id: openVisitRow.id, arrivedAt: openVisitRow.arrivedAt } : null,
    visitSteps,
    followups,
  };
}

export type ClusterSummary = {
  id: string;
  name: string;
  live: number;
  settingUp: number;
  attention: number;
};

/** Cluster list with a one-line summary each. */
export async function loadClusterSummaries(userId: string): Promise<ClusterSummary[]> {
  const { getUserClusters } = await import("@/lib/operations/clusters");
  const clusters = await getUserClusters([userId]);
  if (clusters.length === 0) return [];
  // One pass over all the user's interventions, bucketed by cluster.
  const rowsPerCluster = await Promise.all(
    clusters.map(async (c) => ({ c, rows: await loadInterventions(userId, c.id) })),
  );
  return rowsPerCluster
    .map(({ c, rows }): ClusterSummary => ({
      id: c.id,
      name: c.name,
      live: rows.filter((r) => r.phase === "live").length,
      settingUp: rows.filter((r) => r.phase === "setting_up").length,
      attention: rows.filter((r) => r.needsAttention).length,
    }))
    .filter((c) => c.live + c.settingUp > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}
