"use client";

import { Flag } from "lucide-react";
import { progressTagColor } from "@/lib/progressTags";
import type { CentrePlan } from "@/lib/operations/plan";
import { StatusIcon, subItemStatus } from "./statusIcon";

/**
 * SSR-safe + mobile rendering of the plan: an indented WBS outline (workstream → node → sub-items),
 * with dependency annotations ("needs 1.2") and critical-path marks. Same data as the graph.
 */
export function PlanOutline({ plan, onOpen }: { plan: CentrePlan; onOpen: (pitstopId: string) => void }) {
  const wbsById = new Map(plan.workstreams.flatMap((w) => w.nodes).map((n) => [n.pitstopId, n.wbs]));
  return (
    <div className="space-y-4">
      {plan.workstreams.map((w) => (
        <section key={w.tag}>
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`w-2 h-2 rounded-full ${progressTagColor(w.tag).filled}`} />
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">{w.index}. {w.label}</h3>
          </div>
          <div className="space-y-1.5">
            {w.nodes.map((n) => (
              <div
                key={n.pitstopId}
                onClick={() => onOpen(n.pitstopId)}
                className={`rounded-lg border bg-white px-3 py-2 cursor-pointer hover:border-stone-300 ${n.onCriticalPath ? "border-red-300" : "border-stone-200"}`}
              >
                <div className="flex items-center gap-2">
                  <StatusIcon status={n.status} />
                  {n.isMilestone && <Flag className="w-3.5 h-3.5 text-stone-700" />}
                  <span className="text-[10px] font-semibold text-stone-400 tabular-nums">{n.wbs}</span>
                  <span className={`text-sm flex-1 min-w-0 truncate ${n.status === "done" ? "text-stone-400 line-through" : "text-stone-800"}`}>{n.title}</span>
                  {n.onCriticalPath && <span className="text-[9px] font-bold uppercase text-red-500">CP</span>}
                </div>
                {n.blockedBy.length > 0 && (
                  <p className="text-[10px] text-stone-400 pl-6 mt-0.5">needs {n.blockedBy.map((id) => wbsById.get(id) ?? "?").join(", ")}</p>
                )}
                {n.subItems.length > 0 && (
                  <div className="pl-6 mt-1 space-y-0.5">
                    {n.subItems.map((s) => (
                      <div key={s.checklistId} className="flex items-center gap-1.5">
                        <StatusIcon status={subItemStatus(s.status, s.doneCount, s.totalCount)} className="w-3 h-3" />
                        <span className="text-[11px] text-stone-500 truncate flex-1">{s.text}</span>
                        {s.totalCount > 1 && <span className="text-[9px] text-stone-400 tabular-nums">{s.doneCount}/{s.totalCount}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
