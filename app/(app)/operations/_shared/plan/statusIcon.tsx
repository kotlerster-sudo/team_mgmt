"use client";

import { CheckCircle2, CircleDashed, Loader2, OctagonAlert } from "lucide-react";
import type { PlanNodeStatus } from "@/lib/operations/plan";

/** ✅🔄⛔⬜ mapping for a WBS node / sub-item, using the app's status palette. */
export const STATUS_META: Record<PlanNodeStatus, { icon: typeof CheckCircle2; color: string; ring: string; label: string }> = {
  done:        { icon: CheckCircle2, color: "text-emerald-500", ring: "border-emerald-300", label: "Done" },
  in_progress: { icon: Loader2,      color: "text-sky-500",     ring: "border-sky-300",     label: "In progress" },
  blocked:     { icon: OctagonAlert, color: "text-red-500",     ring: "border-red-300",     label: "Blocked" },
  todo:        { icon: CircleDashed, color: "text-stone-300",   ring: "border-stone-200",   label: "Not started" },
};

export function StatusIcon({ status, className = "w-4 h-4" }: { status: PlanNodeStatus; className?: string }) {
  const M = STATUS_META[status];
  return <M.icon className={`${className} ${M.color} shrink-0`} />;
}

/** Map a raw ChecklistItemStatus to the same 4-way scheme for sub-item icons. */
export function subItemStatus(status: string, doneCount: number, totalCount: number): PlanNodeStatus {
  if (status === "Done" || (totalCount > 0 && doneCount >= totalCount)) return "done";
  if (status === "Blocked") return "blocked";
  if (status === "InProgress" || doneCount > 0) return "in_progress";
  return "todo";
}
