/**
 * Setup-centre "one-page plan" loader — a WBS view over the spine (goal → pitstops → checklists →
 * activities) for a Goal.mode="setup" centre. Pure read: workstreams (grouped by progressTag) →
 * numbered nodes (pitstops) → sub-items (checklists, with their activity done-counts), plus the
 * dependency edges (PitstopDependency), the computed critical path + this-week chase target, and
 * which workstream branches carry slack. Reuses lib/progressTags.ts for grouping + criticalPath.ts.
 */

import prisma from "@/lib/prisma";
import { orderProgressTags } from "@/lib/progressTags";
import { computeCriticalPath, type CpNode } from "./criticalPath";

export type PlanNodeStatus = "done" | "blocked" | "in_progress" | "todo";

export type PlanSubItem = {
  checklistId: string;
  text: string;
  status: string;
  completionType: string;
  doneCount: number;
  totalCount: number;
};

export type PlanNode = {
  pitstopId: string;
  wbs: string; // "1.2"
  title: string;
  status: PlanNodeStatus;
  rawStatus: string;
  isMilestone: boolean;
  ownerName: string | null;
  startDate: string | null;
  targetDate: string | null;
  blockedBy: string[]; // predecessor pitstop ids
  onCriticalPath: boolean;
  subItems: PlanSubItem[];
};

export type PlanWorkstream = { tag: string; label: string; index: number; nodes: PlanNode[] };

export type CentrePlan = {
  goalId: string;
  goalTitle: string;
  targetDate: string | null;
  workstreams: PlanWorkstream[];
  edges: { from: string; to: string }[]; // predecessor → dependent
  thisWeek: { pitstopId: string; wbs: string; title: string; ownerName: string | null; targetDate: string | null } | null;
  slackBranches: string[];
  counts: { total: number; done: number; blocked: number };
};

const UNGROUPED = "Ungrouped";

export async function loadCentrePlan(goalId: string): Promise<CentrePlan | null> {
  const goal = await prisma.goal.findFirst({
    where: { id: goalId, deletedAt: null },
    select: { id: true, title: true, targetDate: true },
  });
  if (!goal) return null;

  const pitstops = await prisma.pitstop.findMany({
    where: { goalId, deletedAt: null, recurrence: "None" }, // one-time setup work
    select: {
      id: true, title: true, status: true, order: true, progressTag: true, isMilestone: true,
      startDate: true, targetDate: true,
      owner: { select: { name: true } },
      checklistItems: {
        where: { status: { not: "Cancelled" } },
        select: {
          id: true, text: true, status: true, completionType: true,
          activities: { where: { deletedAt: null }, select: { status: true } },
        },
        orderBy: { order: "asc" },
      },
      blockedBy: { select: { blockedById: true } }, // predecessors of this pitstop
    },
    orderBy: [{ order: "asc" }],
  });

  const doneById = new Map(pitstops.map((p) => [p.id, p.status === "Done"]));
  const idsInPlan = new Set(pitstops.map((p) => p.id));

  // Critical path over the dependency DAG (edges limited to pitstops in this plan).
  const cpNodes: CpNode[] = pitstops.map((p) => ({
    id: p.id,
    blockedBy: p.blockedBy.map((d) => d.blockedById).filter((id) => idsInPlan.has(id)),
    done: p.status === "Done",
  }));
  const milestoneIds = pitstops.filter((p) => p.isMilestone).map((p) => p.id);
  const { path, frontId } = computeCriticalPath(cpNodes, milestoneIds);

  const nodeStatus = (p: (typeof pitstops)[number]): PlanNodeStatus => {
    if (p.status === "Done") return "done";
    const blockedByDep = p.blockedBy.some((d) => idsInPlan.has(d.blockedById) && !doneById.get(d.blockedById));
    const blockedByItem = p.checklistItems.some((c) => c.status === "Blocked");
    if (blockedByDep || blockedByItem) return "blocked";
    if (p.status === "InProgress") return "in_progress";
    return "todo";
  };

  // Group into workstreams by progressTag (canonical order), then number nodes within each.
  const tags = orderProgressTags(pitstops.map((p) => p.progressTag || UNGROUPED));
  const workstreams: PlanWorkstream[] = tags.map((tag, wi) => {
    const nodes = pitstops
      .filter((p) => (p.progressTag || UNGROUPED) === tag)
      .map((p, ni): PlanNode => ({
        pitstopId: p.id,
        wbs: `${wi + 1}.${ni + 1}`,
        title: p.title,
        status: nodeStatus(p),
        rawStatus: p.status,
        isMilestone: p.isMilestone,
        ownerName: p.owner?.name ?? null,
        startDate: p.startDate ? p.startDate.toISOString() : null,
        targetDate: p.targetDate ? p.targetDate.toISOString() : null,
        blockedBy: p.blockedBy.map((d) => d.blockedById).filter((id) => idsInPlan.has(id)),
        onCriticalPath: path.has(p.id),
        subItems: p.checklistItems.map((c): PlanSubItem => {
          const total = c.activities.length || 1;
          const done = c.activities.length
            ? c.activities.filter((a) => a.status === "Done").length
            : c.status === "Done" ? 1 : 0;
          return { checklistId: c.id, text: c.text, status: c.status, completionType: c.completionType, doneCount: done, totalCount: total };
        }),
      }));
    return { tag, label: tag, index: wi + 1, nodes };
  }).filter((w) => w.nodes.length > 0);

  const edges: { from: string; to: string }[] = [];
  for (const p of pitstops) for (const d of p.blockedBy) if (idsInPlan.has(d.blockedById)) edges.push({ from: d.blockedById, to: p.id });

  const byId = new Map(workstreams.flatMap((w) => w.nodes).map((n) => [n.pitstopId, n]));
  const front = frontId ? byId.get(frontId) ?? null : null;
  const thisWeek = front
    ? { pitstopId: front.pitstopId, wbs: front.wbs, title: front.title, ownerName: front.ownerName, targetDate: front.targetDate }
    : null;

  const slackBranches = workstreams.filter((w) => !w.nodes.some((n) => n.onCriticalPath)).map((w) => w.label);

  const allNodes = workstreams.flatMap((w) => w.nodes);
  const counts = {
    total: allNodes.length,
    done: allNodes.filter((n) => n.status === "done").length,
    blocked: allNodes.filter((n) => n.status === "blocked").length,
  };

  return {
    goalId: goal.id,
    goalTitle: goal.title,
    targetDate: goal.targetDate ? goal.targetDate.toISOString() : null,
    workstreams,
    edges,
    thisWeek,
    slackBranches,
    counts,
  };
}
