"use client";

import type { DueState } from "./dueState";

/** Shared overdue/today pill — used on NodeCard footers and "On this visit" agenda rows. */
export function DueChip({ due, className = "" }: { due: NonNullable<DueState>; className?: string }) {
  return due.kind === "overdue" ? (
    <span className={`text-[10px] font-semibold text-red-600 bg-red-50 rounded-full px-1.5 py-0.5 shrink-0 ${className}`}>
      {due.days}d overdue
    </span>
  ) : (
    <span className={`text-[10px] font-semibold text-amber-700 bg-amber-50 rounded-full px-1.5 py-0.5 shrink-0 ${className}`}>
      Today
    </span>
  );
}
