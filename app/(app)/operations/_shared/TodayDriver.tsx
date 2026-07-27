"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import type { Activity, ChecklistItem } from "@/app/(app)/home/_lib/types";
import { fmtTime, daysAgo } from "@/app/(app)/home/_lib/helpers";
import { ActivityCard } from "@/app/(app)/home/_shared/ActivityCard";
import { useSessionDoneIds } from "@/app/(app)/home/_shared/useSessionDoneIds";

/**
 * The Operations landing "today" driver: every activity due today + everything
 * overdue, across ALL programmes, in one completable list — so an RP sees the
 * whole day without drilling programme → centre → activity. Each row already
 * carries its own settlement · cluster · programme context (via ActivityCard),
 * so the list stays legible when it spans domains.
 *
 * Completion reuses ActivityCard (writes to the spine: indicators, follow-ups,
 * Done cascade). Read-only under admin "view as". Buckets come pre-split from
 * loadTodayDriver — today already includes displayDate-pulled items and overdue
 * already excludes them, so we trust the server split rather than re-bucketing.
 */
export function TodayDriver({
  today,
  overdue,
  checklists,
  readOnly = false,
  storageKey,
}: {
  today: Activity[];
  overdue: Activity[];
  checklists: ChecklistItem[];
  readOnly?: boolean;
  storageKey: string;
}) {
  const router = useRouter();
  const { ids: doneIds, add: addDone } = useSessionDoneIds(storageKey);

  const checklistMap = useMemo(() => {
    const m = new Map<string, ChecklistItem>();
    for (const ci of checklists) for (const a of ci.activities) m.set(a.id, ci);
    return m;
  }, [checklists]);

  const pending = (a: Activity) => a.status !== "Done" && !doneIds.has(a.id);
  const todayList = today.filter(pending);
  const overdueList = overdue.filter(pending);

  const handleCompleted = (eventId: string) => { addDone(eventId); router.refresh(); };

  const renderRow = (a: Activity, isOverdue = false) =>
    readOnly ? (
      <ReadOnlyRow key={a.id} activity={a} overdue={isOverdue} />
    ) : (
      <ActivityCard
        key={a.id}
        activity={a}
        linkedChecklist={checklistMap.get(a.id) ?? null}
        onCompleted={handleCompleted}
        onRescheduled={() => router.refresh()}
        isOverdue={isOverdue}
      />
    );

  if (todayList.length === 0 && overdueList.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
        <CheckCircle2 className="w-5 h-5 text-emerald-500 mx-auto" />
        <p className="text-sm font-medium text-emerald-800 mt-1.5">You&apos;re all caught up for today.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {todayList.length > 0 && (
        <Section title="Today">
          {todayList.map((a) => renderRow(a, false))}
        </Section>
      )}
      {overdueList.length > 0 && (
        <Section title={`Overdue (${overdueList.length})`} tone="amber">
          {overdueList.map((a) => renderRow(a, true))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, tone = "stone", children }: { title: string; tone?: "stone" | "amber"; children: React.ReactNode }) {
  return (
    <section>
      <h2 className={`text-[11px] font-semibold uppercase tracking-wider mb-2 ${tone === "amber" ? "text-amber-700" : "text-stone-500"}`}>
        {title}
      </h2>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

/** Non-interactive row for admin "view as" preview. */
function ReadOnlyRow({ activity, overdue }: { activity: Activity; overdue: boolean }) {
  const goal = activity.pitstops?.[0]?.pitstop?.goal;
  const settlement = goal?.needsSettlement?.name ?? goal?.linkedFacility?.name ?? null;
  const cluster = goal?.needsCluster?.name ?? goal?.linkedFacility?.cluster?.name ?? null;
  const context = [settlement, cluster].filter(Boolean).join(" · ");
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 ${overdue ? "border-amber-200 bg-amber-50/50" : "border-stone-200 bg-white"}`}>
      <div className="flex-shrink-0 w-12 text-right">
        {overdue
          ? <span className="text-[10px] font-semibold text-amber-700">{daysAgo(activity.scheduledAt)}d</span>
          : <span className="text-[11px] font-medium text-stone-500 tabular-nums">{fmtTime(activity.scheduledAt)}</span>}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-stone-700 truncate">{activity.title}</p>
        {context && <p className="text-[11px] text-stone-400 truncate">{context}</p>}
      </div>
    </div>
  );
}
