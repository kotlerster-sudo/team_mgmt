import { auth } from "@/lib/auth";
import { isBudgetAdminOrSuperAdmin } from "@/lib/roleGuard";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { listGrantingUnits } from "@/lib/budget/grantingUnits";
import ReviewQueueView from "./ReviewQueueView";

// Reports still waiting on the partner only reach the queue once they are close
// enough to chase. Every future slot of every grant is noise, not a worklist.
const CHASE_WINDOW_DAYS = 14;

export default async function ReviewQueuePage() {
  const session = await auth();
  if (!session?.user || !isBudgetAdminOrSuperAdmin(session)) redirect("/budget");

  const [slots, units] = await Promise.all([
    prisma.budgetReportSlot.findMany({
      where: { status: { in: ["submitted", "sent_back", "pending"] }, budget: { status: "approved" } },
      select: {
        id: true, slotNumber: true, grantYear: true, dueDate: true, status: true,
        periodFrom: true, periodTo: true,
        budget: {
          select: {
            id: true, name: true, city: true, grantLeadId: true,
            grantLead: { select: { name: true, email: true } },
            grantPartner: { select: { name: true } },
          },
        },
        report: {
          select: {
            submittedAt: true,
            lineNotes: { where: { resolvedAt: null }, select: { id: true } },
            reallocationRequests: { where: { status: "pending" }, select: { id: true } },
          },
        },
      },
    }),
    listGrantingUnits(),
  ]);

  // Slot dates are generated in UTC; compare in UTC so the IST evening doesn't
  // roll a due date a day early.
  const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const today = day(new Date());

  const rows = slots
    .map((s) => ({
      slotId: s.id,
      budgetId: s.budget.id,
      budgetName: s.budget.name,
      partnerName: s.budget.grantPartner?.name ?? "—",
      city: s.budget.city,
      grantLeadId: s.budget.grantLeadId,
      grantLeadName: s.budget.grantLead?.name ?? s.budget.grantLead?.email ?? "Unassigned",
      grantYear: s.grantYear,
      slotNumber: s.slotNumber,
      status: s.status,
      dueDate: s.dueDate.toISOString(),
      periodFrom: s.periodFrom.toISOString(),
      periodTo: s.periodTo.toISOString(),
      submittedAt: s.report?.submittedAt?.toISOString() ?? null,
      openQueries: s.report?.lineNotes.length ?? 0,
      pendingReallocations: s.report?.reallocationRequests.length ?? 0,
      daysLeft: Math.round((day(s.dueDate) - today) / 86400000),
    }))
    .filter((r) => r.status === "submitted" || r.daysLeft <= CHASE_WINDOW_DAYS);

  return (
    <ReviewQueueView
      rows={rows}
      units={units.map((u) => ({ id: u.id, name: u.name }))}
      currentUserId={session.user.id}
    />
  );
}
