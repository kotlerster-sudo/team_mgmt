"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type Row = {
  slotId: string; budgetId: string; budgetName: string; partnerName: string;
  city: string; grantLeadId: string | null; grantLeadName: string;
  grantYear: number; slotNumber: number; status: string;
  dueDate: string; periodFrom: string; periodTo: string; submittedAt: string | null;
  openQueries: number; pendingReallocations: number; daysLeft: number;
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" });

function DueChip({ daysLeft }: { daysLeft: number }) {
  return (
    <span className={`text-xs whitespace-nowrap ${daysLeft < 0 ? "font-medium text-red-600" : "text-stone-500"}`}>
      {daysLeft < 0 ? `${-daysLeft}d overdue` : daysLeft === 0 ? "due today" : `in ${daysLeft}d`}
    </span>
  );
}

function QueueRow({ r, waitingDays }: { r: Row; waitingDays: number | null }) {
  return (
    <li>
      <Link href={`/budget/${r.budgetId}/reports/${r.slotId}`}
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-stone-50">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-stone-900">{r.partnerName}</div>
          <div className="truncate text-xs text-stone-400">
            {r.budgetName} · Y{r.grantYear} R{r.slotNumber} · {fmtDate(r.periodFrom)}–{fmtDate(r.periodTo)} · {r.grantLeadName}
          </div>
        </div>
        <div className="flex items-center gap-2 whitespace-nowrap">
          {r.pendingReallocations > 0 && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
              {r.pendingReallocations} reallocation{r.pendingReallocations === 1 ? "" : "s"}
            </span>
          )}
          {r.openQueries > 0 && (
            <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-700">
              {r.openQueries} open quer{r.openQueries === 1 ? "y" : "ies"}
            </span>
          )}
          {r.status === "sent_back" && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-600">Sent back</span>}
          {waitingDays !== null
            ? <span className={`text-xs whitespace-nowrap ${waitingDays >= 7 ? "font-medium text-red-600" : "text-stone-500"}`}>
                waiting {waitingDays}d
              </span>
            : <DueChip daysLeft={r.daysLeft} />}
        </div>
      </Link>
    </li>
  );
}

export default function ReviewQueueView({
  rows, units, currentUserId,
}: { rows: Row[]; units: { id: string; name: string }[]; currentUserId: string }) {
  const tabs = ["All", ...units.map((u) => u.name)];
  const [city, setCity] = useState("All");
  const [mineOnly, setMineOnly] = useState(false);

  const myCount = useMemo(() => rows.filter((r) => r.grantLeadId === currentUserId).length, [rows, currentUserId]);

  const filtered = useMemo(() => {
    let r = city === "All" ? rows : rows.filter((x) => x.city === city);
    if (mineOnly) r = r.filter((x) => x.grantLeadId === currentUserId);
    return r;
  }, [rows, city, mineOnly, currentUserId]);

  const today = Date.now();
  const toReview = useMemo(
    () => filtered
      .filter((r) => r.status === "submitted")
      // Longest-waiting first: a report sitting unreviewed is the partner's next
      // instalment held up.
      .sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? "")),
    [filtered],
  );
  const toChase = useMemo(
    () => filtered.filter((r) => r.status !== "submitted").sort((a, b) => a.daysLeft - b.daysLeft),
    [filtered],
  );

  const waitingDays = (iso: string | null) =>
    iso === null ? 0 : Math.max(0, Math.floor((today - new Date(iso).getTime()) / 86400000));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/budget/dashboard" className="text-xs text-stone-400 hover:text-stone-600">← Dashboard</Link>
          <h1 className="text-xl font-semibold text-stone-900">Report queue</h1>
          <p className="text-sm text-stone-500">What is waiting on you, and what is waiting on a partner.</p>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-stone-200 overflow-x-auto">
        {tabs.map((c) => (
          <button key={c} onClick={() => setCity(c)}
            className={`whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 -mb-px ${city === c ? "border-sky-600 text-sky-700" : "border-transparent text-stone-500 hover:text-stone-800"}`}>
            {c}
          </button>
        ))}
        <button onClick={() => setMineOnly((v) => !v)} disabled={myCount === 0}
          title={myCount === 0 ? "No grants list you as grant lead yet." : undefined}
          className={`ml-auto shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${mineOnly ? "bg-sky-600 text-white" : "text-stone-500 hover:bg-stone-100"} disabled:opacity-40 disabled:hover:bg-transparent`}>
          My portfolio ({myCount})
        </button>
      </div>

      <section>
        <h2 className="text-sm font-semibold text-stone-700 mb-2">
          Awaiting your review {toReview.length > 0 && <span className="text-stone-400 font-normal">({toReview.length})</span>}
        </h2>
        {toReview.length === 0 ? (
          <p className="rounded-xl border border-stone-200 bg-white p-5 text-sm text-stone-400">Nothing submitted for review.</p>
        ) : (
          <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
            {toReview.map((r) => <QueueRow key={r.slotId} r={r} waitingDays={waitingDays(r.submittedAt)} />)}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-stone-700 mb-2">
          Waiting on a partner {toChase.length > 0 && <span className="text-stone-400 font-normal">({toChase.length})</span>}
        </h2>
        {toChase.length === 0 ? (
          <p className="rounded-xl border border-stone-200 bg-white p-5 text-sm text-stone-400">Nothing due in the next two weeks.</p>
        ) : (
          <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
            {toChase.map((r) => <QueueRow key={r.slotId} r={r} waitingDays={null} />)}
          </ul>
        )}
      </section>
    </div>
  );
}
