"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronDown, Flag, ListChecks, Check, Loader2 } from "lucide-react";
import type { Activity, ChecklistItem } from "@/app/(app)/home/_lib/types";
import type { CentreFollowUp } from "@/lib/operations/today";
import type { CentrePhase } from "@/lib/operations/phase";
import { isToday, fmtDate } from "@/app/(app)/home/_lib/helpers";
import { ActivityCard } from "@/app/(app)/home/_shared/ActivityCard";
import { useSessionDoneIds } from "@/app/(app)/home/_shared/useSessionDoneIds";
import { ReadOnlyChecklistBlock } from "./ReadOnlyChecklistBlock";
import { CentreSummary } from "./CentreSummary";

/**
 * One centre's work: its activities (this visit's checklist tasks) grouped
 * Today / Overdue / Upcoming, plus open follow-ups. Completion reuses
 * ActivityCard so it writes to the spine. Read-only in admin "view as".
 */
export function CentreDetail({
  activities,
  checklists,
  followUps,
  readOnly = false,
  storageKey,
  initialOpen = "today",
  phase,
  monthDone,
  monthRequired,
}: {
  activities: Activity[];
  checklists: ChecklistItem[];
  followUps: CentreFollowUp[];
  readOnly?: boolean;
  storageKey: string;
  /** Which bucket starts expanded (driven by the drill-down lens). */
  initialOpen?: "today" | "overdue";
  /** Summary-band inputs (Gap 3). */
  phase?: CentrePhase;
  monthDone?: number | null;
  monthRequired?: number | null;
}) {
  const router = useRouter();
  const { ids: doneIds, add: addDone } = useSessionDoneIds(storageKey);

  const checklistMap = useMemo(() => {
    const m = new Map<string, ChecklistItem>();
    for (const ci of checklists) for (const a of ci.activities) m.set(a.id, ci);
    return m;
  }, [checklists]);

  const buckets = useMemo(() => {
    const overdue: Activity[] = [];
    const todayList: Activity[] = [];
    const upcoming: Activity[] = [];
    const past: Activity[] = [];
    for (const a of activities) {
      const done = a.status === "Done" || doneIds.has(a.id);
      if (done) past.push(a);
      else if (isToday(a.scheduledAt)) todayList.push(a);
      else if (new Date(a.scheduledAt) < startOfToday()) overdue.push(a);
      else upcoming.push(a);
    }
    const asc = (x: Activity, y: Activity) => new Date(x.scheduledAt).getTime() - new Date(y.scheduledAt).getTime();
    const desc = (x: Activity, y: Activity) => new Date(y.scheduledAt).getTime() - new Date(x.scheduledAt).getTime();
    return {
      overdue: overdue.sort(asc), today: todayList.sort(asc), upcoming: upcoming.sort(asc),
      past: past.sort(desc),
      overall: [...activities].sort(desc),
    };
  }, [activities, doneIds]);

  const handleCompleted = (eventId: string) => { addDone(eventId); router.refresh(); };

  // Close a follow-up (action point) in place. Gated server-side on action_point.update (TEAM),
  // so a supervisor can close on the RP's behalf; the owner can close their own.
  const [closingId, setClosingId] = useState<string | null>(null);
  const closeFollowUp = async (id: string) => {
    setClosingId(id);
    const res = await fetch(`/api/action-points/${id}/complete`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    });
    setClosingId(null);
    if (res.ok) router.refresh();
  };

  // Read-only (supervisory) buckets: group each activity under the checklist it hangs off and
  // render the rich ReadOnlyChecklistBlock — the same structure the RP works through (completion
  // type, required/pending badges, indicators, done-count), minus the action buttons.
  const renderReadOnlyBucket = (list: Activity[], overdue: boolean) => {
    const groups = groupByChecklist(list, checklistMap);
    return groups.map((g) => (
      <ReadOnlyChecklistBlock
        key={g.checklist?.id ?? "__none"}
        checklist={g.checklist}
        items={g.items}
        overdue={overdue}
      />
    ));
  };

  // Interactive (owner) buckets: keep the ActivityCard completion flow, grouped by checklist.
  const renderInteractiveBucket = (list: Activity[], overdue: boolean) => {
    const groups = groupByChecklist(list, checklistMap);
    const onlyUngrouped = groups.length === 1 && groups[0].checklist === null;
    const row = (a: Activity) => (
      <ActivityCard
        key={a.id}
        activity={a}
        linkedChecklist={checklistMap.get(a.id) ?? null}
        onCompleted={handleCompleted}
        onRescheduled={() => router.refresh()}
        isOverdue={overdue}
      />
    );
    if (onlyUngrouped) return groups[0].items.map(row);
    return groups.map((g) => (
      <ChecklistGroup key={g.checklist?.id ?? "__none"} checklist={g.checklist} count={g.items.length}>
        {g.items.map(row)}
      </ChecklistGroup>
    ));
  };

  // Today/Overdue/Upcoming follow the mode; Overall/Past are always read-only (both modes).
  const renderBucket = (list: Activity[], overdue: boolean) =>
    readOnly ? renderReadOnlyBucket(list, overdue) : renderInteractiveBucket(list, overdue);

  // Supervisors (read-only drill-down) get everything collapsed by default; the interactive RP
  // view keeps the lens bucket (Today/Overdue) open so they land on today's work.
  const openToday = !readOnly && initialOpen === "today";
  const openOverdue = !readOnly && initialOpen === "overdue";
  const nothing = activities.length === 0 && followUps.length === 0;

  const summaryCounts = {
    overdue: buckets.overdue.length,
    today: buckets.today.length,
    upcoming: buckets.upcoming.length,
    overall: buckets.overdue.length + buckets.today.length + buckets.upcoming.length,
    done: buckets.past.length,
    followUps: followUps.length,
  };

  return (
    <div className="space-y-3">
      {!nothing && (
        <CentreSummary
          counts={summaryCounts}
          lifecycle={phase?.lifecycle}
          monthDone={monthDone}
          monthRequired={monthRequired}
        />
      )}

      {followUps.length > 0 && (
        <Section title="Open follow-ups" count={followUps.length} tone="amber" defaultOpen={false}>
          {followUps.map((f) => (
            <div key={f.id} className="flex items-center gap-2.5 rounded-lg border border-stone-200 bg-white px-4 py-2.5">
              <Flag className={`w-3.5 h-3.5 flex-shrink-0 ${f.priority === "urgent" ? "text-red-500" : "text-stone-400"}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-stone-800 truncate">{f.title}</p>
                {f.detail && <p className="text-[11px] text-stone-500 mt-0.5 truncate">{f.detail}</p>}
              </div>
              {f.dueDate && <span className="text-[11px] text-stone-400 flex-shrink-0">{fmtDate(f.dueDate)}</span>}
              <button
                onClick={() => closeFollowUp(f.id)}
                disabled={closingId === f.id}
                className="inline-flex items-center gap-1 rounded-lg bg-stone-900 text-white px-2.5 py-1.5 text-xs font-medium hover:bg-stone-700 disabled:opacity-50 flex-shrink-0"
              >
                {closingId === f.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Close
              </button>
            </div>
          ))}
        </Section>
      )}

      {buckets.today.length > 0 && (
        <Section title="Today" count={buckets.today.length} defaultOpen={openToday}>
          {renderBucket(buckets.today, false)}
        </Section>
      )}
      {buckets.overdue.length > 0 && (
        <Section title="Overdue" count={buckets.overdue.length} tone="amber" defaultOpen={openOverdue}>
          {renderBucket(buckets.overdue, true)}
        </Section>
      )}
      {buckets.upcoming.length > 0 && (
        <Section title="Upcoming" count={buckets.upcoming.length} defaultOpen={false}>
          {renderBucket(buckets.upcoming, false)}
        </Section>
      )}
      {buckets.overall.length > 0 && (
        <Section title="Overall" count={buckets.overall.length} defaultOpen={false}>
          {renderReadOnlyBucket(buckets.overall, false)}
        </Section>
      )}
      {buckets.past.length > 0 && (
        <Section title="Past actions" count={buckets.past.length} defaultOpen={false}>
          {renderReadOnlyBucket(buckets.past, false)}
        </Section>
      )}

      {nothing && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 mx-auto" />
          <p className="text-sm font-medium text-emerald-800 mt-1.5">No activities here yet.</p>
        </div>
      )}
    </div>
  );
}

function startOfToday() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
}

/**
 * Groups a time bucket's activities by the checklist they hang off, preserving the
 * incoming (time-sorted) order both across and within groups. Activities with no linked
 * checklist collapse into a single trailing "null" group ("Other activities").
 */
function groupByChecklist(list: Activity[], map: Map<string, ChecklistItem>) {
  const order: string[] = [];
  const byKey = new Map<string, { checklist: ChecklistItem | null; items: Activity[] }>();
  for (const a of list) {
    const ci = map.get(a.id) ?? null;
    const key = ci?.id ?? "__none";
    if (!byKey.has(key)) { byKey.set(key, { checklist: ci, items: [] }); order.push(key); }
    byKey.get(key)!.items.push(a);
  }
  return order.map((k) => byKey.get(k)!);
}

/**
 * Nested collapsible for one checklist inside a time bucket. Lighter than the top-level
 * Section so it reads as a sub-group. Defaults open — the parent Section already gates
 * visibility, and hiding the tasks a second time would bury them.
 */
function ChecklistGroup({
  checklist, count, children,
}: {
  checklist: ChecklistItem | null;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-lg border border-stone-200/70 bg-white/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left"
        aria-expanded={open}
      >
        <ChevronDown className={`w-3.5 h-3.5 text-stone-400 flex-shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} />
        <ListChecks className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />
        <span className="flex-1 min-w-0 truncate text-xs font-medium text-stone-600">
          {checklist?.text ?? "Other activities"}
        </span>
        <span className="text-[10px] font-semibold rounded-full px-1.5 py-0.5 tabular-nums text-stone-500 bg-stone-100">
          {count}
        </span>
      </button>
      {open && <div className="space-y-1.5 px-2 pb-2">{children}</div>}
    </div>
  );
}

/**
 * Collapsible bucket. Keeps long Today/Overdue/Follow-up lists from becoming a
 * laundry list — the count sits in the header so the user sees the size before
 * expanding. Open state is local (defaultOpen seeds it from the drill-down lens).
 */
function Section({
  title, count, tone = "stone", defaultOpen, children,
}: {
  title: string;
  count: number;
  tone?: "stone" | "amber";
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-xl border border-stone-200 bg-white/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform ${open ? "" : "-rotate-90"}`} />
        <span className={`text-[11px] font-semibold uppercase tracking-wider ${tone === "amber" ? "text-amber-700" : "text-stone-500"}`}>
          {title}
        </span>
        <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 tabular-nums ${tone === "amber" ? "text-amber-700 bg-amber-50 border border-amber-200" : "text-stone-500 bg-stone-100"}`}>
          {count}
        </span>
      </button>
      {open && <div className="space-y-1.5 px-2.5 pb-2.5">{children}</div>}
    </section>
  );
}
