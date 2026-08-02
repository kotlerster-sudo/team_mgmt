import { auth } from "@/lib/auth";
import { isSuperAdmin, isBudgetAdmin } from "@/lib/roleGuard";
import { getPartnerAccess, partnerCanAccessBudget } from "@/lib/budget/partnerAccess";
import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
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

function fmtDate(d: Date | string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default async function BudgetReportsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const superAdmin = isSuperAdmin(session);
  const budgetAdmin = isBudgetAdmin(session);
  const canReview = superAdmin || budgetAdmin;

  const budget = await prisma.budget.findUnique({
    where: { id },
    include: {
      reportConfig: true,
      reportSlots: {
        orderBy: { slotNumber: "asc" },
        include: { report: { select: { id: true, submittedAt: true, approvedAt: true } } },
      },
    },
  });

  if (!budget) notFound();
  const partnerAccess = await getPartnerAccess(session);
  // Who may fill: the budget's creator (internal owner) or the linked grantee.
  const canFill = budget.partnerId === session!.user!.id! || partnerCanAccessBudget(partnerAccess, budget);
  if (!canReview && !canFill) notFound();
  const isPartner = canFill;

  if (budget.status !== "approved" || !budget.reportConfig) {
    return (
      <div className="text-center py-20 text-stone-400">
        <p className="text-sm">This budget has not been approved yet.</p>
        <p className="text-xs mt-1 text-stone-300">Reporting slots will appear here once the budget is approved.</p>
      </div>
    );
  }

  const byYear = budget.reportSlots.reduce<Record<number, typeof budget.reportSlots>>((acc, s) => {
    (acc[s.grantYear] ??= []).push(s);
    return acc;
  }, {});

  return (
    <div>
      <div className="mb-6">
        <Link href={partnerAccess.isPartner ? "/budget" : `/budget/${id}`} className="text-xs text-stone-400 hover:text-stone-700">← {partnerAccess.isPartner ? "My budgets" : budget.name}</Link>
        <h1 className="text-xl font-semibold text-stone-900 mt-2">Reports</h1>
        <p className="text-sm text-stone-500 mt-0.5">
          {budget.reportConfig.frequency.replace("_", "-")} reporting ·{" "}
          {fmtDate(budget.reportConfig.grantStartDate)} – {fmtDate(budget.reportConfig.grantEndDate)}
        </p>
      </div>

      <div className="space-y-8">
        {Object.entries(byYear).map(([year, slots]) => (
          <section key={year}>
            <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide mb-3">Grant Year {year}</h2>
            <div className="space-y-2">
              {slots.map(slot => {
                const isOpen = ["pending", "sent_back"].includes(slot.status) && isPartner;
                const isReview = slot.status === "submitted" && canReview && !isPartner;
                const isView = slot.status === "approved" || (canReview && !isPartner && !["pending", "sent_back"].includes(slot.status));
                const href = `/budget/${id}/reports/${slot.id}`;
                const overdue = slot.status === "pending" && new Date(slot.dueDate) < new Date();

                return (
                  <div key={slot.id} className="bg-white border border-stone-200 rounded-xl px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-stone-900">
                          {fmtDate(slot.periodFrom)} – {fmtDate(slot.periodTo)}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[slot.status]}`}>
                          {STATUS_LABEL[slot.status]}
                        </span>
                        {overdue && <span className="text-xs text-red-500">Overdue</span>}
                      </div>
                      <p className="text-xs text-stone-400 mt-0.5">
                        Due {fmtDate(slot.dueDate)}
                        {slot.report?.submittedAt && ` · Submitted ${fmtDate(slot.report.submittedAt)}`}
                        {slot.report?.approvedAt && ` · Approved ${fmtDate(slot.report.approvedAt)}`}
                      </p>
                    </div>
                    <Link href={href}
                      className={`text-sm px-4 py-1.5 rounded-lg transition-all whitespace-nowrap ${
                        isOpen ? "bg-sky-600 hover:bg-sky-700 text-white" :
                        isReview ? "bg-amber-500 hover:bg-amber-600 text-white" :
                        "border border-stone-200 text-stone-600 hover:border-stone-400"
                      }`}>
                      {isOpen ? "Fill report" : isReview ? "Review" : "View"}
                    </Link>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
