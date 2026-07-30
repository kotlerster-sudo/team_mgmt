/**
 * Client-side date bucketing for the WBS plan — overdue / due-today chips on nodes plus the
 * "On this visit" agenda (overdue + today only, critical-path first). Lives client-side on
 * purpose: the plan loader runs on the server (UTC on Vercel) so any "is today" comparison
 * there would drift from the RP's local day; local Y/M/D comparison here matches the home
 * module's isToday() idiom (never iso.slice(0,10)).
 */

import type { CentrePlan, PlanNode, PlanNodeStatus } from "@/lib/operations/plan";

export type DueState = { kind: "overdue"; days: number } | { kind: "today" } | null;

export type AgendaRow = {
  pitstopId: string;
  wbs: string;
  title: string;
  status: PlanNodeStatus;
  ownerName: string | null;
  due: NonNullable<DueState>;
  onCriticalPath: boolean;
};

export type Agenda = {
  rows: AgendaRow[]; // only overdue + due-today, ranked critical-path first then earliest date
  nextUpId: string | null; // nearest-dated node that is actionable (all predecessors done)
  waitingOn: { nodeId: string; onWbs: string } | null; // set instead when the nearest-dated node is blocked
};

const localMidnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const DAY_MS = 86_400_000;

export function getDueState(targetDate: string | null, status: PlanNodeStatus): DueState {
  if (!targetDate || status === "done") return null;
  const due = localMidnight(new Date(targetDate));
  const today = localMidnight(new Date());
  if (due === today) return { kind: "today" };
  if (due < today) return { kind: "overdue", days: Math.max(1, Math.floor((today - due) / DAY_MS)) };
  return null;
}

export function buildAgenda(plan: CentrePlan): Agenda {
  const allNodes = plan.workstreams.flatMap((w) => w.nodes);
  const byId = new Map(allNodes.map((n) => [n.pitstopId, n]));
  const doneIds = new Set(allNodes.filter((n) => n.status === "done").map((n) => n.pitstopId));
  // "Actionable" = every predecessor done — deliberately NOT status === "blocked", which also
  // fires on a blocked checklist item (that node is still the one to chase on a visit).
  const actionable = (n: PlanNode) => n.status !== "done" && n.blockedBy.every((id) => doneIds.has(id));

  const rows: AgendaRow[] = allNodes
    .map((n) => ({ n, due: getDueState(n.targetDate, n.status) }))
    .filter((x): x is { n: PlanNode; due: NonNullable<DueState> } => x.due !== null)
    .map(({ n, due }) => ({
      pitstopId: n.pitstopId, wbs: n.wbs, title: n.title, status: n.status,
      ownerName: n.ownerName, due, onCriticalPath: n.onCriticalPath,
    }))
    .sort((a, b) => {
      if (a.onCriticalPath !== b.onCriticalPath) return a.onCriticalPath ? -1 : 1;
      const da = byId.get(a.pitstopId)!.targetDate!, db = byId.get(b.pitstopId)!.targetDate!;
      if (da !== db) return da < db ? -1 : 1;
      return a.wbs.localeCompare(b.wbs, undefined, { numeric: true });
    });

  // Nearest-dated open node: highlight it as NEXT if actionable, else point at what it waits on.
  const nearest = allNodes
    .filter((n) => n.status !== "done" && n.targetDate)
    .sort((a, b) => (a.targetDate! < b.targetDate! ? -1 : 1))[0];

  let nextUpId: string | null = null;
  let waitingOn: Agenda["waitingOn"] = null;
  if (nearest) {
    if (actionable(nearest)) nextUpId = nearest.pitstopId;
    else {
      const openPred = nearest.blockedBy.find((id) => !doneIds.has(id));
      waitingOn = { nodeId: nearest.pitstopId, onWbs: openPred ? byId.get(openPred)?.wbs ?? "?" : "?" };
    }
  }

  return { rows, nextUpId, waitingOn };
}
