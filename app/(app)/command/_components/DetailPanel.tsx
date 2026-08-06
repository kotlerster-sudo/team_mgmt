"use client";

/**
 * Right-side detail panel for one selected centre/goal — fetched from
 * /api/command/detail. Sections: header · setup WBS strip · indicator trends ·
 * visit timeline with observations (notes, voice, failed non-negotiables) ·
 * follow-ups with ageing. Desktop: sticky right column. Mobile: full-screen
 * sheet.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowUpRight, CheckCircle2, Flame, Mic, X,
} from "lucide-react";
import type { CommandRow } from "@/lib/operations/command";
import type { CentrePlan } from "@/lib/operations/plan";
import { Sparkline } from "./cells";
import { progressTagColor } from "@/lib/progressTags";

type DetailVisit = {
  eventId: string;
  title: string;
  status: string;
  scheduledAt: string;
  arrivedAt: string | null;
  completedAt: string | null;
  completedBy: string | null;
  description: string | null;
  messages: { id: string; body: string; msgType: string; audioUrl: string | null; author: string | null; createdAt: string }[];
  captures: {
    defLabel: string;
    unit: string | null;
    value: number;
    note: string | null;
    capturedAt: string;
    failedItems: string[];
    failedNonNegotiables: string[];
  }[];
  apsRaised: number;
};

type DetailIndicator = {
  def: { id: string; key: string; label: string; unit: string | null; sortOrder: number };
  target: number | null;
  series: { capturedAt: string; value: number; source: string }[];
};

type DetailAp = {
  id: string;
  title: string;
  detail: string | null;
  partnerStaffLabel: string | null;
  priority: string;
  dueDate: string;
  createdAt: string;
  owner: string | null;
  ageDays: number;
};

type CommandDetail = {
  goal: { id: string; title: string; mode: string; themeKey: string | null; targetDate: string | null };
  facility: {
    id: string; name: string; layerKey: string; lat: number; lng: number;
    settlement: { id: string; name: string } | null;
    cluster: { id: string; name: string } | null;
  } | null;
  rp: { id: string; name: string | null } | null;
  plan: CentrePlan | null;
  visits: DetailVisit[];
  indicators: DetailIndicator[];
  actionPoints: {
    open: DetailAp[];
    recentClosed: { id: string; title: string; closureNote: string | null; completedAt: string | null; completedBy: string | null }[];
  };
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 mb-2">{title}</p>
      {children}
    </div>
  );
}

export function DetailPanel({ row, onClose }: { row: CommandRow; onClose: () => void }) {
  const [detail, setDetail] = useState<CommandDetail | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(false);
    fetch(`/api/command/detail?goalId=${encodeURIComponent(row.goalId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => !cancelled && setDetail(d))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [row.goalId]);

  return (
    <div className="fixed inset-0 z-40 lg:static lg:z-auto">
      {/* Mobile scrim */}
      <div className="absolute inset-0 bg-black/30 lg:hidden" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-md lg:static lg:h-auto lg:max-w-none bg-white lg:bg-transparent overflow-y-auto lg:overflow-visible">
        <div className="lg:border lg:border-stone-200 lg:rounded-xl bg-white p-4 space-y-5 min-h-full lg:min-h-0">
          {/* Header */}
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: row.themeColor }} />
                <h2 className="text-sm font-bold text-stone-900 truncate">{row.name}</h2>
              </div>
              <p className="text-[11px] text-stone-400 mt-0.5">
                {[row.themeLabel, row.settlementName, row.clusterName].filter(Boolean).join(" · ")}
              </p>
              <p className="text-[11px] text-stone-500 mt-0.5">
                {row.rp?.name && <>RP: <span className="font-medium text-stone-700">{row.rp.name}</span></>}
                {row.live?.lastVisitAt && <> · last visit {fmtDate(row.live.lastVisitAt)}</>}
                {row.live && !row.live.lastVisitAt && <> · <span className="text-red-500 font-medium">no visits in window</span></>}
              </p>
            </div>
            <Link
              href={`/operations/${encodeURIComponent(row.themeKey)}/${row.goalId}`}
              className="inline-flex items-center gap-0.5 text-[11px] font-medium text-sky-600 hover:text-sky-700 shrink-0 mt-0.5"
            >
              Open <ArrowUpRight className="w-3 h-3" />
            </Link>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-stone-100 text-stone-400 shrink-0" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>

          {error && <p className="text-xs text-red-500">Couldn&apos;t load detail — try again.</p>}
          {!detail && !error && <p className="text-xs text-stone-400 py-6 text-center">Loading…</p>}

          {detail && (
            <>
              {/* Setup WBS strip */}
              {detail.plan && (
                <Section title={`Setup plan · ${detail.plan.counts.done}/${detail.plan.counts.total} steps${detail.plan.counts.blocked > 0 ? ` · ${detail.plan.counts.blocked} blocked` : ""}`}>
                  <div className="space-y-1.5">
                    {detail.plan.workstreams.map((w) => {
                      const done = w.nodes.filter((n) => n.status === "done").length;
                      const blocked = w.nodes.some((n) => n.status === "blocked");
                      const isFrontWs = row.setup?.front?.workstream === w.tag;
                      const color = progressTagColor(w.tag);
                      return (
                        <div key={w.tag} className="flex items-center gap-2">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-md border ${color.pill} min-w-[86px] text-center truncate`}>
                            {w.label}
                          </span>
                          <div className="flex-1 flex gap-0.5">
                            {w.nodes.map((n) => (
                              <span
                                key={n.pitstopId}
                                title={`${n.wbs} ${n.title} · ${n.status}${n.onCriticalPath ? " · critical path" : ""}`}
                                className={`h-2 flex-1 rounded-sm ${
                                  n.status === "done" ? "bg-emerald-400"
                                  : n.status === "blocked" ? "bg-red-400"
                                  : n.status === "in_progress" ? "bg-sky-400"
                                  : "bg-stone-200"
                                } ${n.onCriticalPath ? "ring-1 ring-amber-300" : ""}`}
                              />
                            ))}
                          </div>
                          <span className={`text-[10px] tabular-nums ${blocked ? "text-red-500 font-semibold" : "text-stone-400"}`}>
                            {done}/{w.nodes.length}
                          </span>
                          {isFrontWs && <span className="text-[9px] font-bold text-sky-600 uppercase">now</span>}
                        </div>
                      );
                    })}
                  </div>
                  {row.setup?.front && (
                    <div className={`mt-2 rounded-lg px-2.5 py-2 text-[11px] ${row.setup.front.daysOverdue > 0 || row.setup.front.daysStuck >= 14 ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>
                      <span className="inline-flex items-center gap-1 font-semibold">
                        {row.setup.front.onCriticalPath && <Flame className="w-3 h-3" />}
                        Stuck on: {row.setup.front.title}
                      </span>
                      <span> · in this step ~{row.setup.front.daysStuck}d</span>
                      {row.setup.front.daysOverdue > 0 && <span> · {row.setup.front.daysOverdue}d past target</span>}
                      {row.setup.front.onCriticalPath && <span> · on the critical path</span>}
                    </div>
                  )}
                </Section>
              )}

              {/* Indicators */}
              {detail.indicators.length > 0 && (
                <Section title="Indicators (12 months)">
                  <div className="space-y-2.5">
                    {detail.indicators.map((ind) => {
                      const latest = ind.series[ind.series.length - 1];
                      return (
                        <div key={ind.def.id} className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] text-stone-600 truncate">{ind.def.label}</p>
                            <p className="text-[10px] text-stone-400">
                              {latest ? `${latest.value}${ind.def.unit ?? ""}` : "—"}
                              {ind.target != null && <> / target {ind.target}{ind.def.unit ?? ""}</>}
                              {latest && <> · {fmtDate(latest.capturedAt)}</>}
                            </p>
                          </div>
                          <Sparkline points={ind.series.map((p) => p.value)} />
                        </div>
                      );
                    })}
                  </div>
                </Section>
              )}

              {/* Follow-ups */}
              <Section title={`Follow-ups · ${detail.actionPoints.open.length} open`}>
                {detail.actionPoints.open.length === 0 ? (
                  <p className="text-[11px] text-stone-400">Nothing open.</p>
                ) : (
                  <div className="space-y-1.5">
                    {detail.actionPoints.open.map((ap) => {
                      const overdue = new Date(ap.dueDate) < new Date();
                      return (
                        <div key={ap.id} className="rounded-lg border border-stone-100 px-2.5 py-2">
                          <div className="flex items-center gap-1.5">
                            {overdue && <AlertTriangle className="w-3 h-3 text-red-500 shrink-0" />}
                            <p className="text-[11px] font-medium text-stone-800 flex-1 truncate">{ap.title}</p>
                            <span className={`text-[10px] tabular-nums shrink-0 ${overdue ? "text-red-600 font-semibold" : "text-stone-400"}`}>
                              due {fmtDate(ap.dueDate)}{overdue && ` · ${ap.ageDays}d`}
                            </span>
                          </div>
                          {ap.detail && <p className="text-[10px] text-stone-500 mt-0.5 line-clamp-2">{ap.detail}</p>}
                          <p className="text-[10px] text-stone-400 mt-0.5">
                            {[ap.owner, ap.partnerStaffLabel].filter(Boolean).join(" · ")}
                            {ap.priority === "urgent" && <span className="text-red-500 font-semibold"> · urgent</span>}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
                {detail.actionPoints.recentClosed.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {detail.actionPoints.recentClosed.map((ap) => (
                      <p key={ap.id} className="text-[10px] text-stone-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span className="truncate">{ap.title}</span>
                        <span className="shrink-0">· {fmtDate(ap.completedAt)}{ap.completedBy ? ` by ${ap.completedBy}` : ""}</span>
                      </p>
                    ))}
                  </div>
                )}
              </Section>

              {/* Visit timeline + observations */}
              {detail.visits.length > 0 && (
                <Section title="Visits & observations">
                  <div className="space-y-2.5">
                    {detail.visits.map((v) => (
                      <div key={v.eventId} className="rounded-lg border border-stone-100 px-2.5 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${v.status === "Done" ? "bg-emerald-400" : v.status === "Cancelled" ? "bg-stone-300" : "bg-amber-400"}`} />
                          <p className="text-[11px] font-medium text-stone-800 flex-1 truncate">
                            {fmtDate(v.completedAt ?? v.scheduledAt)}
                            {v.completedBy && <span className="font-normal text-stone-500"> · {v.completedBy}</span>}
                          </p>
                          <span className="text-[10px] text-stone-400 shrink-0">
                            {v.status}{v.apsRaised > 0 && ` · ${v.apsRaised} AP${v.apsRaised === 1 ? "" : "s"}`}
                          </span>
                        </div>
                        {v.description && <p className="text-[10px] text-stone-600 mt-1 whitespace-pre-line line-clamp-4">{v.description}</p>}
                        {v.captures.map((c, i) => (
                          <div key={i} className="mt-1 text-[10px]">
                            <span className="text-stone-500">{c.defLabel}: </span>
                            <span className="font-semibold text-stone-700 tabular-nums">{c.value}{c.unit ?? ""}</span>
                            {c.note && <span className="text-stone-400"> · {c.note}</span>}
                            {c.failedNonNegotiables.length > 0 && (
                              <span className="block text-red-600 font-medium mt-0.5">
                                ⚠ non-negotiable failing: {c.failedNonNegotiables.join("; ")}
                              </span>
                            )}
                            {c.failedItems.length > c.failedNonNegotiables.length && (
                              <span className="block text-amber-600 mt-0.5">
                                failing: {c.failedItems.filter((f) => !c.failedNonNegotiables.includes(f)).join("; ")}
                              </span>
                            )}
                          </div>
                        ))}
                        {v.messages.map((m) => (
                          <div key={m.id} className="mt-1.5 rounded-md bg-stone-50 px-2 py-1.5">
                            <p className="text-[9px] text-stone-400">{m.author ?? "—"} · {fmtDate(m.createdAt)}</p>
                            {m.msgType === "voice" && m.audioUrl ? (
                              <span className="flex items-center gap-1.5 mt-0.5">
                                <Mic className="w-3 h-3 text-violet-500 shrink-0" />
                                <audio controls src={m.audioUrl} className="h-7 w-full" preload="none" />
                              </span>
                            ) : (
                              <p className="text-[10px] text-stone-600 whitespace-pre-line line-clamp-3">{m.body}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
