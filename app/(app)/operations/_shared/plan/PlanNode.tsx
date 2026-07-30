"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Flag, User } from "lucide-react";
import { progressTagColor } from "@/lib/progressTags";
import type { PlanNode as PlanNodeData } from "@/lib/operations/plan";
import { StatusIcon, subItemStatus } from "./statusIcon";

export type PlanNodeProps = {
  node: PlanNodeData;
  workstreamTag: string;
  onOpen: (pitstopId: string) => void;
  editable: boolean;
};

/** One WBS node (a pitstop): number + status + title + sub-items + owner/date. */
function PlanNodeInner({ data }: NodeProps) {
  const { node, workstreamTag, onOpen } = data as unknown as PlanNodeProps;
  const cp = node.onCriticalPath;
  const accent = progressTagColor(workstreamTag).filled; // e.g. "bg-violet-500"

  if (node.isMilestone) {
    return (
      <div
        onClick={() => onOpen(node.pitstopId)}
        className={`cursor-pointer select-none rounded-xl px-4 py-2.5 text-center shadow-sm border-2 ${
          node.status === "done" ? "bg-emerald-500 border-emerald-600 text-white" : "bg-white border-stone-800 text-stone-900"
        }`}
      >
        <Handle type="target" position={Position.Top} className="!bg-stone-400" />
        <div className="flex items-center gap-1.5 justify-center">
          <Flag className="w-3.5 h-3.5" />
          <span className="text-sm font-bold tracking-wide uppercase">{node.title}</span>
        </div>
        <Handle type="source" position={Position.Bottom} className="!bg-stone-400" />
      </div>
    );
  }

  return (
    <div
      onClick={() => onOpen(node.pitstopId)}
      className={`cursor-pointer select-none w-60 rounded-xl bg-white shadow-sm border ${
        cp ? "border-red-400 ring-1 ring-red-200" : "border-stone-200"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-stone-300" />
      <div className="flex items-start gap-2 px-3 pt-2.5 pb-1.5">
        <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${accent}`} title={workstreamTag} />
        <StatusIcon status={node.status} className="w-4 h-4 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-stone-400 tabular-nums">{node.wbs}</span>
            {cp && <span className="text-[9px] font-bold uppercase text-red-500 tracking-wide">critical</span>}
          </div>
          <p className={`text-[13px] font-medium leading-snug ${node.status === "done" ? "text-stone-400 line-through" : "text-stone-800"}`}>
            {node.title}
          </p>
        </div>
      </div>

      {node.subItems.length > 0 && (
        <div className="px-3 pb-1.5 space-y-0.5">
          {node.subItems.slice(0, 5).map((s) => (
            <div key={s.checklistId} className="flex items-center gap-1.5">
              <StatusIcon status={subItemStatus(s.status, s.doneCount, s.totalCount)} className="w-3 h-3" />
              <span className="text-[11px] text-stone-500 truncate flex-1">{s.text}</span>
              {s.totalCount > 1 && <span className="text-[9px] text-stone-400 tabular-nums">{s.doneCount}/{s.totalCount}</span>}
            </div>
          ))}
          {node.subItems.length > 5 && <p className="text-[10px] text-stone-400 pl-4">+{node.subItems.length - 5} more</p>}
        </div>
      )}

      {(node.ownerName || node.targetDate) && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-t border-stone-100 text-[10px] text-stone-400">
          {node.ownerName && <span className="inline-flex items-center gap-0.5 truncate"><User className="w-2.5 h-2.5" />{node.ownerName}</span>}
          {node.targetDate && <span className="ml-auto tabular-nums">{new Date(node.targetDate).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-stone-300" />
    </div>
  );
}

export const PlanNode = memo(PlanNodeInner);
