"use client";

/**
 * ActionPointCard — single AP row, used across:
 *   - Home Today (one card per due-today / overdue AP)
 *   - Home Follow-ups tab (rows in each bucket)
 *   - Pitstop detail page (nested list under each activity)
 *
 * Props are deliberately verbose so the parent decides what context to show
 * (don't show goal+pitstop when we're already on the pitstop page). Callbacks
 * are optional — pass only what the surface supports.
 */

import { useState } from "react";
import Link from "next/link";
import { Check, Clock, AlertTriangle, MoreHorizontal, Pencil, XCircle, RotateCcw, Image as ImageIcon } from "lucide-react";
import type { ActionPoint } from "./types";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function daysFromToday(iso: string): number {
  // Positive = future, negative = past, 0 = today. IST-aligned to match the
  // bucket boundaries used by /api/action-points.
  const now = new Date();
  const ist = (t: Date) => new Date(t.getTime() + 5.5 * 60 * 60 * 1000);
  const a = ist(new Date(iso)); a.setUTCHours(0, 0, 0, 0);
  const b = ist(now);           b.setUTCHours(0, 0, 0, 0);
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

function dueLabel(iso: string): { text: string; tone: "overdue" | "today" | "soon" | "later" } {
  const d = daysFromToday(iso);
  if (d < 0)  return { text: `${Math.abs(d)}d overdue`, tone: "overdue" };
  if (d === 0) return { text: "Today",                  tone: "today" };
  if (d <= 3) return { text: `In ${d}d`,                tone: "soon" };
  return { text: fmtDate(iso),                          tone: "later" };
}

const toneClasses = {
  overdue: "text-red-600 bg-red-50 border-red-100",
  today:   "text-amber-700 bg-amber-50 border-amber-100",
  soon:    "text-stone-600 bg-stone-50 border-stone-200",
  later:   "text-stone-500 bg-stone-50 border-stone-200",
} as const;

/**
 * A visit follow-up sits under goal › pitstop › activity and can deep-link to it.
 * An ad-hoc task has none of that, so it falls back to the place it was pointed
 * at — and only offers a link when it named a goal.
 */
function describeContext(ap: ActionPoint): { trail: string | null; place: string | null; href: string | null } {
  const trail = [ap.goal?.title, ap.pitstop?.title, ap.pitstopEvent?.title].filter(Boolean).join(" › ") || null;
  const place =
    ap.needsSettlement?.name ?? ap.needsCluster?.name ?? ap.needsZone?.name ?? ap.needsCity?.name ?? null;
  const href = ap.goalId
    ? ap.pitstopId ? `/goals/${ap.goalId}#pitstop-${ap.pitstopId}` : `/goals/${ap.goalId}`
    : null;
  return { trail, place, href };
}

export function ActionPointCard({
  ap, currentUserId,
  showContext = true,
  compact = false,
  onChanged,
  onOpenComplete,
  onOpenEdit,
}: {
  ap: ActionPoint;
  currentUserId: string;
  /** Hide goal/pitstop line when the parent already establishes that context. */
  showContext?: boolean;
  /** Tighter padding for nested lists. */
  compact?: boolean;
  /** Called after a successful state change so the parent can refetch. */
  onChanged?: (next: ActionPoint) => void;
  /** Hand-off to a parent-owned MarkAPDoneModal (so closure-note + proof live there). */
  onOpenComplete?: (ap: ActionPoint) => void;
  /** Hand-off to a parent-owned edit modal. */
  onOpenEdit?: (ap: ActionPoint) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const due = dueLabel(ap.dueDate);
  const context = describeContext(ap);
  const isOwner = ap.ownerId === currentUserId;
  // Someone else's ask: closeable, but the terms of it aren't yours to change.
  const delegatedToMe = isOwner && !!ap.assignedById && ap.assignedById !== currentUserId;
  const isOpen  = ap.status === "open";
  const isDone  = ap.status === "done";

  // Reopen window: 14d after completion. After that the AP is effectively frozen
  // (we still show it in the Done bucket; just no reopen button to avoid
  // resurrecting stale items the team has moved on from).
  const reopenAllowed = isDone && ap.completedAt &&
    Date.now() - new Date(ap.completedAt).getTime() < 14 * 24 * 60 * 60 * 1000;

  async function quickComplete() {
    if (onOpenComplete) { onOpenComplete(ap); return; }
    setBusy(true);
    const res = await fetch(`/api/action-points/${ap.id}/complete`, { method: "POST" });
    setBusy(false);
    if (res.ok) onChanged?.(await res.json());
  }

  async function reopen() {
    setBusy(true);
    const res = await fetch(`/api/action-points/${ap.id}/reopen`, { method: "POST" });
    setBusy(false);
    setMenuOpen(false);
    if (res.ok) onChanged?.(await res.json());
  }

  async function cancel() {
    if (!confirm("Cancel this action point? It will be hidden from open lists.")) return;
    setBusy(true);
    const res = await fetch(`/api/action-points/${ap.id}`, { method: "DELETE" });
    setBusy(false);
    setMenuOpen(false);
    if (res.ok) onChanged?.({ ...ap, status: "cancelled" });
  }

  const pad = compact ? "px-3 py-2.5" : "px-4 py-3";
  const titleSize = compact ? "text-sm" : "text-sm";

  return (
    <div className={`${pad} rounded-xl border bg-white relative ${
      isDone ? "border-stone-200 opacity-80" : ap.priority === "urgent" ? "border-red-200" : "border-stone-200"
    }`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {/* Pill row */}
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-stone-100 text-stone-600 flex items-center gap-1">
              <Check className="w-2.5 h-2.5" /> AP
            </span>
            {ap.priority === "urgent" && (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-red-50 text-red-700 border border-red-100 flex items-center gap-1">
                <AlertTriangle className="w-2.5 h-2.5" /> Urgent
              </span>
            )}
            {isOpen && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium border flex items-center gap-1 ${toneClasses[due.tone]}`}>
                <Clock className="w-2.5 h-2.5" /> {due.text}
              </span>
            )}
            {isDone && (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium border border-emerald-100 bg-emerald-50 text-emerald-700">
                Done · {ap.completedAt ? fmtDate(ap.completedAt) : ""}
              </span>
            )}
            {ap.status === "cancelled" && (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium border border-stone-200 bg-stone-50 text-stone-500">
                Cancelled
              </span>
            )}
            {ap.partnerStaffLabel && (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium text-violet-700 bg-violet-50 border border-violet-100">
                ↪ {ap.partnerStaffLabel}
              </span>
            )}
          </div>

          {/* Title */}
          <p className={`${titleSize} font-medium text-stone-800 leading-snug ${isDone ? "line-through text-stone-500" : ""}`}>
            {ap.title}
          </p>

          {/* Detail */}
          {ap.detail && (
            <p className="text-xs text-stone-500 mt-0.5 line-clamp-2">{ap.detail}</p>
          )}

          {/* Closure note (when done) */}
          {isDone && ap.closureNote && (
            <p className="text-xs text-stone-500 mt-1 italic">"{ap.closureNote}"</p>
          )}
          {isDone && ap.closureProofUrl && (
            <a href={ap.closureProofUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs text-sky-600 hover:underline mt-1">
              <ImageIcon className="w-3 h-3" /> Proof
            </a>
          )}

          {/* Context. A visit follow-up shows its goal › pitstop › activity trail; an ad-hoc
              task has no trail, so it shows wherever it was pointed at instead. */}
          {showContext && (context.trail || context.place) && (
            <p className="text-[11px] text-stone-400 mt-1.5 truncate">
              {context.trail ?? context.place}
              {context.href && (
                <>
                  {" · "}
                  <Link href={context.href} className="text-sky-600 hover:underline">
                    open
                  </Link>
                </>
              )}
            </p>
          )}

          {/* Raised-by line — surfaces the supervisor case (creator != owner is rare in v1) */}
          {!isOwner && ap.owner && (
            <p className="text-[11px] text-stone-400 mt-0.5">For {ap.owner.name ?? "—"}</p>
          )}
          {isOwner && ap.assignedBy && ap.assignedById !== ap.ownerId && (
            <p className="text-[11px] text-stone-400 mt-0.5">
              Asked by {ap.assignedBy.name ?? "—"} · you can close this, not change it
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {isOpen && (
            <button
              onClick={quickComplete}
              disabled={busy}
              className="text-xs px-2.5 py-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
            >
              {busy ? "…" : "Done"}
            </button>
          )}
          {isDone && reopenAllowed && (
            <button
              onClick={reopen}
              disabled={busy}
              className="text-xs px-2.5 py-1.5 text-stone-600 hover:bg-stone-100 rounded-lg font-medium transition-colors flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" /> Reopen
            </button>
          )}
          {(isOpen || isDone) && (
            <div className="relative">
              <button
                onClick={() => setMenuOpen(v => !v)}
                className="p-1.5 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-lg transition-colors"
                aria-label="More actions"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-stone-200 rounded-lg shadow-lg py-1 min-w-[140px]">
                    {isOpen && !delegatedToMe && onOpenEdit && (
                      <button
                        onClick={() => { setMenuOpen(false); onOpenEdit(ap); }}
                        className="w-full px-3 py-1.5 text-left text-xs text-stone-700 hover:bg-stone-50 flex items-center gap-2"
                      >
                        <Pencil className="w-3 h-3" /> Edit
                      </button>
                    )}
                    {isOpen && !delegatedToMe && (
                      <button
                        onClick={cancel}
                        disabled={busy}
                        className="w-full px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 flex items-center gap-2"
                      >
                        <XCircle className="w-3 h-3" /> Cancel
                      </button>
                    )}
                    {isOpen && delegatedToMe && (
                      <p className="px-3 py-1.5 text-[11px] text-stone-400 leading-snug">
                        Only {ap.assignedBy?.name ?? "the person who asked"} can change or cancel this.
                      </p>
                    )}
                    {isDone && reopenAllowed && (
                      <button
                        onClick={reopen}
                        disabled={busy}
                        className="w-full px-3 py-1.5 text-left text-xs text-stone-700 hover:bg-stone-50 flex items-center gap-2"
                      >
                        <RotateCcw className="w-3 h-3" /> Reopen
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
