"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, ClipboardCheck, Flag, Loader2, MapPin } from "lucide-react";
import type { PendingApproval, OpenActionPoint } from "@/lib/operations/oversight";

/**
 * Supervisor review queues shown atop the oversight tree: pending ad-hoc catalog items
 * (approve / reject) and open action points (close-out). Both mutate then router.refresh()
 * so the queue and the tree rollups re-read. Reuses the existing action-point complete route.
 */
export function ApprovalsPanel({
  approvals, actionPoints,
}: {
  approvals: PendingApproval[];
  actionPoints: OpenActionPoint[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const decide = async (id: string, action: "approve" | "reject") => {
    setBusy(id);
    await fetch(`/api/operations/approvals/${id}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusy(null);
    router.refresh();
  };

  const closeAp = async (id: string) => {
    setBusy(id);
    await fetch(`/api/action-points/${id}/complete`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    });
    setBusy(null);
    router.refresh();
  };

  if (approvals.length === 0 && actionPoints.length === 0) return null;

  return (
    <div className="space-y-3">
      {approvals.length > 0 && (
        <section className="rounded-xl border border-violet-200 bg-violet-50/40">
          <Header icon={<ClipboardCheck className="w-4 h-4 text-violet-600" />} title="Items awaiting approval" count={approvals.length} />
          <div className="space-y-1.5 px-2.5 pb-2.5">
            {approvals.map((a) => (
              <div key={a.id} className="flex items-center gap-2.5 rounded-lg border border-stone-200 bg-white px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-stone-800 truncate">{a.itemText}</p>
                  <p className="text-[11px] text-stone-400 truncate">
                    {a.goalTitle}
                    {a.clusterName && <> · {a.clusterName}</>}
                    {a.addedByName && <> · added by {a.addedByName}</>}
                  </p>
                </div>
                <button
                  onClick={() => decide(a.id, "approve")}
                  disabled={busy === a.id}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 text-white px-2.5 py-1.5 text-xs font-medium hover:bg-emerald-700 disabled:opacity-50 shrink-0"
                >
                  {busy === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Approve
                </button>
                <button
                  onClick={() => decide(a.id, "reject")}
                  disabled={busy === a.id}
                  className="inline-flex items-center gap-1 rounded-lg border border-stone-200 text-stone-600 px-2.5 py-1.5 text-xs font-medium hover:bg-stone-50 disabled:opacity-50 shrink-0"
                >
                  <X className="w-3.5 h-3.5" /> Reject
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {actionPoints.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/40">
          <Header icon={<Flag className="w-4 h-4 text-amber-600" />} title="Open follow-ups" count={actionPoints.length} />
          <div className="space-y-1.5 px-2.5 pb-2.5">
            {actionPoints.map((f) => (
              <div key={f.id} className="flex items-center gap-2.5 rounded-lg border border-stone-200 bg-white px-3 py-2">
                <Flag className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${f.priority === "urgent" ? "text-red-500" : "text-stone-400"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-stone-800 truncate">{f.title}</p>
                  <p className="text-[11px] text-stone-400 truncate">
                    {f.goalTitle}
                    {f.clusterName && <span className="inline-flex items-center gap-0.5"> · <MapPin className="w-2.5 h-2.5" />{f.clusterName}</span>}
                    {f.ownerName && <> · {f.ownerName}</>}
                  </p>
                </div>
                <button
                  onClick={() => closeAp(f.id)}
                  disabled={busy === f.id}
                  className="inline-flex items-center gap-1 rounded-lg bg-stone-900 text-white px-2.5 py-1.5 text-xs font-medium hover:bg-stone-700 disabled:opacity-50 shrink-0"
                >
                  {busy === f.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Close
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Header({ icon, title, count }: { icon: React.ReactNode; title: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2.5">
      {icon}
      <span className="text-sm font-medium text-stone-800 flex-1">{title}</span>
      <span className="text-[10px] font-semibold rounded-full px-1.5 py-0.5 tabular-nums text-stone-600 bg-white border border-stone-200">
        {count}
      </span>
    </div>
  );
}
