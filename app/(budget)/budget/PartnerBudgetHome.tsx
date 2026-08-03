import Link from "next/link";

const STATUS_LABEL: Record<string, string> = {
  pending: "Not started", submitted: "Submitted", under_review: "Under review",
  sent_back: "Sent back", approved: "Approved",
};
const STATUS_COLOR: Record<string, string> = {
  pending: "bg-stone-100 text-stone-500",
  submitted: "bg-sky-100 text-sky-700",
  under_review: "bg-amber-100 text-amber-700",
  sent_back: "bg-red-100 text-red-700",
  approved: "bg-green-100 text-green-700",
};

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

// Slot dates are built in UTC (lib/budget-report-slots.ts), so compare whole UTC
// days — a plain timestamp comparison flips "due today" to "overdue" through the
// IST evening.
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const daysUntil = (due: string) => Math.round((utcDay(new Date(due)) - utcDay(new Date())) / 86400000);

type Slot = { id: string; slotNumber: number; grantYear: number; periodFrom: string; periodTo: string; dueDate: string; status: string; report: { submittedAt: string | null; approvedAt: string | null } | null };
type Budget = {
  id: string; name: string; city: string; status: string;
  partnerEditState: "closed" | "open" | "submitted";
  partnerSubmittedAt: string | null;
  reportConfig: { frequency: string } | null;
  reportSlots: Slot[];
};

export default function PartnerBudgetHome({ budgets, linked }: { budgets: Budget[]; linked: boolean }) {
  if (!linked) {
    return (
      <div className="max-w-xl">
        <h1 className="text-xl font-semibold text-stone-900">Grant reporting</h1>
        <p className="text-sm text-stone-500 mt-2">Your login isn’t linked to a grantee organisation yet. Please contact your programme manager at the Foundation.</p>
      </div>
    );
  }

  // Reports due (fillable states) grouped by budget; slots date-sorted within a
  // budget, budgets ordered by their soonest deadline.
  const dueByBudget = budgets
    .map(b => ({
      id: b.id,
      name: b.name,
      city: b.city,
      slots: b.reportSlots
        .filter(s => ["pending", "sent_back"].includes(s.status))
        .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()),
    }))
    .filter(g => g.slots.length > 0)
    .sort((a, b) => new Date(a.slots[0].dueDate).getTime() - new Date(b.slots[0].dueDate).getTime());

  const drafts = budgets.filter(b => b.partnerEditState !== "closed");

  const allDue = dueByBudget.flatMap(g => g.slots).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const overdueCount = allDue.filter(s => daysUntil(s.dueDate) < 0).length;
  const next = allDue.find(s => daysUntil(s.dueDate) >= 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-stone-900">Grant reporting</h1>
        <p className="text-sm text-stone-500 mt-0.5">Your budgets and the reports due.</p>
      </div>

      {allDue.length > 0 && (
        <div className={`rounded-xl border px-4 sm:px-5 py-3 text-sm ${overdueCount > 0 ? "border-red-200 bg-red-50 text-red-800" : "border-stone-200 bg-white text-stone-700"}`}>
          {overdueCount > 0 && (
            <span className="font-semibold">{overdueCount} report{overdueCount === 1 ? "" : "s"} overdue.</span>
          )}
          {next && (
            <span className={overdueCount > 0 ? "ml-1.5 opacity-90" : ""}>
              Next due {fmtDate(next.dueDate)} ({daysUntil(next.dueDate) === 0 ? "today" : `in ${daysUntil(next.dueDate)} days`}).
            </span>
          )}
        </div>
      )}

      {/* Draft budgets shared for the grantee's input, and ones they've handed back */}
      {drafts.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide mb-3">Budget awaiting your input</h2>
          <div className="space-y-2">
            {drafts.map(b => (
              <div key={b.id} className="bg-white border border-stone-200 rounded-xl px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-stone-900">{b.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${b.partnerEditState === "open" ? "bg-sky-100 text-sky-700" : "bg-green-100 text-green-700"}`}>
                      {b.partnerEditState === "open" ? "Open for your edits" : "Submitted"}
                    </span>
                  </div>
                  <p className="text-xs text-stone-400 mt-0.5">
                    {b.partnerEditState === "open"
                      ? "Adjust the line items and workings to your own costs, then submit."
                      : `Sent to the Foundation${b.partnerSubmittedAt ? ` on ${fmtDate(b.partnerSubmittedAt)}` : ""}. They'll come back to you if anything needs changing.`}
                  </p>
                </div>
                <Link href={`/budget/${b.id}/draft`}
                  className={`text-sm px-4 py-1.5 rounded-lg whitespace-nowrap ${b.partnerEditState === "open" ? "bg-sky-600 hover:bg-sky-700 text-white" : "border border-stone-300 text-stone-700 hover:bg-stone-50"}`}>
                  {b.partnerEditState === "open" ? "Open budget" : "View"}
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Reports due */}
      <section>
        <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide mb-3">Reports due</h2>
        {dueByBudget.length === 0
          ? <p className="text-sm text-stone-400 bg-white border border-stone-200 rounded-xl p-5">Nothing due right now. 🎉</p>
          : (
            <div className="space-y-5">
              {dueByBudget.map(g => (
                <div key={g.id}>
                  <div className="flex items-baseline gap-2 mb-2 px-1">
                    <h3 className="text-sm font-semibold text-stone-900">{g.name}</h3>
                    <span className="text-xs text-stone-400">{g.city} · {g.slots.length} due</span>
                  </div>
                  <div className="space-y-2">
                    {g.slots.map(s => {
                      const left = daysUntil(s.dueDate);
                      return (
                        <div key={s.id} className="bg-white border border-stone-200 rounded-xl px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-stone-900">{fmtDate(s.periodFrom)} – {fmtDate(s.periodTo)}</span>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[s.status]}`}>{STATUS_LABEL[s.status]}</span>
                              {left < 0
                                ? <span className="text-xs font-medium text-red-500">{-left} day{left === -1 ? "" : "s"} overdue</span>
                                : <span className="text-xs text-stone-500">{left === 0 ? "Due today" : `in ${left} days`}</span>}
                            </div>
                            <p className="text-xs text-stone-400 mt-0.5">Due {fmtDate(s.dueDate)}</p>
                          </div>
                          <Link href={`/budget/${g.id}/reports/${s.id}`}
                            className="text-sm px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white whitespace-nowrap">
                            Fill report
                          </Link>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
      </section>

      {/* Budgets */}
      <section>
        <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide mb-3">Your budgets</h2>
        {budgets.length === 0
          ? <p className="text-sm text-stone-400 bg-white border border-stone-200 rounded-xl p-5">No budgets assigned yet.</p>
          : (
            <div className="space-y-2">
              {budgets.map(b => {
                const total = b.reportSlots.length;
                const done = b.reportSlots.filter(s => s.status === "approved").length;
                return (
                  <Link key={b.id} href={`/budget/${b.id}/reports`}
                    className="block bg-white border border-stone-200 rounded-xl px-4 sm:px-5 py-4 hover:border-sky-300 hover:shadow-sm transition-all">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-stone-900">{b.name}</div>
                        <div className="text-xs text-stone-400 mt-0.5">{b.city}{b.reportConfig ? ` · ${b.reportConfig.frequency.replace("_", "-")} reporting` : ""}</div>
                      </div>
                      <span className="text-xs text-stone-400 whitespace-nowrap">
                        {b.status === "approved" ? `${done}/${total} reports approved` : "Awaiting approval"}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
      </section>
    </div>
  );
}
