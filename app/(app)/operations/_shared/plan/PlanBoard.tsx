"use client";

import { Fragment } from "react";
import { ChevronDown, Flag, User } from "lucide-react";
import { progressTagColor } from "@/lib/progressTags";
import type { CentrePlan, PlanNode } from "@/lib/operations/plan";
import { StatusIcon, subItemStatus } from "./statusIcon";

/**
 * Clean vertical WBS outline (the shape of the launch-plan mock): workstream sections stacked
 * top-to-bottom, each a chain of node cards with sub-items inside; a down-arrow connector between a
 * node and the next when the next depends on it; "needs X.Y" chips for other dependencies; milestone
 * nodes render as distinct centred gate boxes at the foot. Responsive — same on desktop and mobile.
 */
export function PlanBoard({ plan, onOpen }: { plan: CentrePlan; onOpen: (pitstopId: string) => void }) {
  const wbsById = new Map(plan.workstreams.flatMap((w) => w.nodes).map((n) => [n.pitstopId, n.wbs]));
  const milestones = plan.workstreams.flatMap((w) => w.nodes.filter((n) => n.isMilestone).map((n) => ({ node: n, tag: w.tag })));

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {plan.workstreams.map((w) => {
        const nodes = w.nodes.filter((n) => !n.isMilestone);
        if (nodes.length === 0) return null;
        return (
          <section key={w.tag}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-2.5 h-2.5 rounded-full ${progressTagColor(w.tag).filled}`} />
              <h3 className="text-sm font-bold text-stone-800 tracking-tight">{w.index}. {w.label.toUpperCase()}</h3>
            </div>
            <div className="pl-1.5">
              {nodes.map((n, i) => {
                const prev = nodes[i - 1];
                const flowsFromPrev = !!prev && n.blockedBy.includes(prev.pitstopId);
                return (
                  <Fragment key={n.pitstopId}>
                    {i > 0 && <Connector active={flowsFromPrev} />}
                    <NodeCard node={n} wbsById={wbsById} prevId={prev?.pitstopId} onOpen={onOpen} />
                  </Fragment>
                );
              })}
            </div>
          </section>
        );
      })}

      {milestones.length > 0 && (
        <div className="flex flex-col items-center gap-2 pt-2">
          <Connector active />
          {milestones.map(({ node }) => (
            <button
              key={node.pitstopId}
              onClick={() => onOpen(node.pitstopId)}
              className={`inline-flex items-center gap-2 rounded-lg border-2 px-6 py-2.5 font-bold uppercase tracking-wide text-sm ${
                node.status === "done" ? "bg-emerald-500 border-emerald-600 text-white" : "bg-white border-stone-800 text-stone-900"
              }`}
            >
              <Flag className="w-4 h-4" /> {node.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Connector({ active }: { active: boolean }) {
  return (
    <div className="flex flex-col items-center py-0.5" aria-hidden>
      <div className={`w-px h-3 ${active ? "bg-stone-400" : "bg-stone-200"}`} />
      <ChevronDown className={`w-3.5 h-3.5 -mt-1 ${active ? "text-stone-400" : "text-stone-200"}`} />
    </div>
  );
}

function NodeCard({ node, wbsById, prevId, onOpen }: {
  node: PlanNode; wbsById: Map<string, string>; prevId?: string; onOpen: (id: string) => void;
}) {
  // "needs" chips only for dependencies that aren't the immediately-preceding node (that link is the arrow).
  const otherDeps = node.blockedBy.filter((id) => id !== prevId);
  return (
    <button
      onClick={() => onOpen(node.pitstopId)}
      className={`w-full text-left rounded-xl bg-white border px-3.5 py-2.5 hover:shadow-sm transition-shadow ${
        node.onCriticalPath ? "border-red-300 ring-1 ring-red-100" : "border-stone-200"
      }`}
    >
      <div className="flex items-center gap-2">
        <StatusIcon status={node.status} className="w-4 h-4" />
        <span className="text-[11px] font-semibold text-stone-400 tabular-nums">{node.wbs}</span>
        <span className={`text-sm font-medium flex-1 min-w-0 ${node.status === "done" ? "text-stone-400 line-through" : "text-stone-800"}`}>{node.title}</span>
        {node.onCriticalPath && <span className="text-[9px] font-bold uppercase text-red-500 tracking-wide shrink-0">critical</span>}
      </div>

      {node.subItems.length > 0 && (
        <div className="mt-1.5 pl-6 space-y-0.5">
          {node.subItems.map((s) => (
            <div key={s.checklistId} className="flex items-center gap-1.5">
              <StatusIcon status={subItemStatus(s.status, s.doneCount, s.totalCount)} className="w-3 h-3" />
              <span className="text-[11px] text-stone-500 truncate flex-1">{s.text}</span>
              {s.totalCount > 1 && <span className="text-[9px] text-stone-400 tabular-nums shrink-0">{s.doneCount}/{s.totalCount}</span>}
            </div>
          ))}
        </div>
      )}

      {(otherDeps.length > 0 || node.ownerName || node.targetDate) && (
        <div className="mt-1.5 pl-6 flex items-center gap-2 flex-wrap text-[10px] text-stone-400">
          {otherDeps.length > 0 && <span className="text-stone-500">needs {otherDeps.map((id) => wbsById.get(id) ?? "?").join(", ")}</span>}
          {node.ownerName && <span className="inline-flex items-center gap-0.5"><User className="w-2.5 h-2.5" />{node.ownerName}</span>}
          {node.targetDate && <span className="ml-auto tabular-nums">{new Date(node.targetDate).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>}
        </div>
      )}
    </button>
  );
}
