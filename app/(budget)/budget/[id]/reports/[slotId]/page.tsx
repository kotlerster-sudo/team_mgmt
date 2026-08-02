import { auth } from "@/lib/auth";
import { isSuperAdmin, isBudgetAdmin } from "@/lib/roleGuard";
import { getPartnerAccess, partnerCanAccessBudget } from "@/lib/budget/partnerAccess";
import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import ReportForm from "./ReportForm";
import ReviewPanel from "./ReviewPanel";

export default async function ReportSlotPage({ params }: { params: Promise<{ id: string; slotId: string }> }) {
  const { id, slotId } = await params;
  const session = await auth();
  const superAdmin = isSuperAdmin(session);
  const budgetAdmin = isBudgetAdmin(session);
  const canReview = superAdmin || budgetAdmin;

  const [slot, budget] = await Promise.all([
    prisma.budgetReportSlot.findUnique({
      where: { id: slotId },
      include: {
        report: {
          include: {
            lines: true,
            fdDetails: { orderBy: { sortOrder: "asc" } },
            reallocationRequests: {
              include: {
                fromLine: { select: { id: true, description: true, section: true } },
                toLine: { select: { id: true, description: true, section: true } },
              },
              orderBy: { createdAt: "asc" },
            },
            lineNotes: {
              include: { author: { select: { id: true, name: true, email: true } } },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    }),
    prisma.budget.findUnique({
      where: { id },
      include: {
        lines: { orderBy: { position: "asc" } },
        reportConfig: true,
      },
    }),
  ]);

  if (!slot || !budget || slot.budgetId !== id) notFound();
  const partnerAccess = await getPartnerAccess(session);
  const isPartner = budget.partnerId === session!.user!.id! || partnerCanAccessBudget(partnerAccess, budget);
  if (!canReview && !isPartner) notFound();

  // Cumulative actuals for all approved/submitted slots in same grant year before this one
  const priorSlots = await prisma.budgetReportSlot.findMany({
    where: {
      budgetId: id,
      grantYear: slot.grantYear,
      slotNumber: { lt: slot.slotNumber },
      status: { in: ["approved", "submitted"] },
    },
    include: { report: { include: { lines: true } } },
  });

  const cumulativePrior: Record<string, number> = {};
  for (const ps of priorSlots) {
    for (const l of ps.report?.lines ?? []) {
      cumulativePrior[l.budgetLineId] = (cumulativePrior[l.budgetLineId] ?? 0) + l.actualAmount;
    }
  }

  // Approved reallocations up to and including this slot (if approved) — for revised budget basis
  const priorApprovedSlots = await prisma.budgetReportSlot.findMany({
    where: { budgetId: id, slotNumber: { lte: slot.slotNumber }, status: "approved" },
    include: {
      report: {
        include: {
          reallocationRequests: {
            where: { status: "approved" },
            select: { fromLineId: true, toLineId: true, approvedAmount: true, targetGrantYear: true },
          },
        },
      },
    },
  });

  // revisedYearTotals[lineId] = original yearTotal ± approved reallocations,
  // for this grant year only. Within a year the money leaves the source line and
  // lands on the destination; carried forward it only lands, because the source
  // year is already reported and its unspent amount lapsed there.
  const revisedAdjustments: Record<string, number> = {};
  for (const ps of priorApprovedSlots) {
    for (const r of ps.report?.reallocationRequests ?? []) {
      if (r.approvedAmount == null) continue;
      const targetYear = r.targetGrantYear ?? ps.grantYear;
      if (r.targetGrantYear == null && ps.grantYear === slot.grantYear) {
        revisedAdjustments[r.fromLineId] = (revisedAdjustments[r.fromLineId] ?? 0) - r.approvedAmount;
      }
      if (targetYear === slot.grantYear && r.toLineId) {
        revisedAdjustments[r.toLineId] = (revisedAdjustments[r.toLineId] ?? 0) + r.approvedAmount;
      }
    }
  }

  const serialized = JSON.parse(JSON.stringify({ slot, budget, cumulativePrior, revisedAdjustments }));
  const canEdit = isPartner && ["pending", "sent_back"].includes(slot.status);
  const isReview = canReview && slot.status === "submitted";
  // Both sides can post while the report is in play: the reviewer raises a query
  // on the submission, the partner answers it once the report comes back.
  const canComment = ["submitted", "sent_back"].includes(slot.status) && (canReview || isPartner);

  return (
    <div>
      {isReview
        ? <ReviewPanel {...serialized} canComment={canComment} canResolveNotes={canReview} />
        : <ReportForm {...serialized} canEdit={canEdit} isSuperAdmin={canReview} canComment={canComment} canResolveNotes={canReview} />
      }
    </div>
  );
}
