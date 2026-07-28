"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, ClipboardCheck, ChevronDown, Loader2 } from "lucide-react";
import type { PendingApproval } from "@/lib/operations/oversight";

/**
 * Pending ad-hoc catalog items awaiting the supervisor's approval. Collapsible and collapsed by
 * default (the count sits in the header) so it never becomes a laundry list. Open follow-ups now
 * live per-centre in the drill-down, not here.
 */
export function ApprovalsPanel({ approvals }: { approvals: PendingApproval[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const decide = async (id: string, action: "approve" | "reject") => {
    setBusy(id);
    await fetch(`/api/operations/approvals/${id}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusy(null);
    router.refresh();
  };

  return (
    <section className="rounded-xl border border-violet-200 bg-violet-50/40">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left" aria-expanded={open}>
        <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform ${open ? "" : "-rotate-90"}`} />
        <ClipboardCheck className="w-4 h-4 text-violet-600" />
        <span className="text-sm font-medium text-stone-800 flex-1">Items awaiting approval</span>
        <span className="text-[10px] font-semibold rounded-full px-1.5 py-0.5 tabular-nums text-stone-600 bg-white border border-stone-200">
          {approvals.length}
        </span>
      </button>
      {open && (
        approvals.length === 0 ? (
          <p className="px-3 pb-3 text-xs text-stone-400">Nothing awaiting approval.</p>
        ) : (
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
        )
      )}
    </section>
  );
}
