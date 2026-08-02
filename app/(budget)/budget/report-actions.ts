"use server";

import { auth } from "@/lib/auth";
import { isSuperAdmin, isBudgetAdminOrSuperAdmin } from "@/lib/roleGuard";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createHash } from "node:crypto";
import { generateSlots } from "@/lib/budget-report-slots";
import { computeDeclarationData } from "@/lib/budget/declarationData";
import { getPartnerAccess, partnerCanAccessBudget } from "@/lib/budget/partnerAccess";
import { declarationInputsComplete, AFFIRMATION_CLAUSES, type DeclarationInputs } from "@/lib/budget/declaration";
import type { ReportFrequency, BudgetSection, ReallocationDuration } from "@/app/generated/prisma/client";

// ── Admin: approve a budget and set up report config ──────────────────────────

export async function approveBudget(
  budgetId: string,
  config: {
    frequency: ReportFrequency;
    grantStartDate: Date;
    grantEndDate: Date;
    dueAfterDays?: number;
  }
) {
  const session = await auth();
  if (!session?.user || !isBudgetAdminOrSuperAdmin(session)) throw new Error("Unauthorized");

  const dueAfterDays = config.dueAfterDays ?? 30;
  const slots = generateSlots(config.grantStartDate, config.grantEndDate, config.frequency, dueAfterDays);

  await prisma.$transaction([
    prisma.budget.update({ where: { id: budgetId }, data: { status: "approved" } }),
    prisma.budgetReportConfig.upsert({
      where: { budgetId },
      create: {
        budgetId,
        frequency: config.frequency,
        grantStartDate: config.grantStartDate,
        grantEndDate: config.grantEndDate,
        dueAfterDays,
      },
      update: {
        frequency: config.frequency,
        grantStartDate: config.grantStartDate,
        grantEndDate: config.grantEndDate,
        dueAfterDays,
      },
    }),
    // Delete future slots only (keep any already submitted/approved)
    prisma.budgetReportSlot.deleteMany({
      where: { budgetId, status: { in: ["pending", "sent_back"] } },
    }),
    ...slots.map(s =>
      prisma.budgetReportSlot.upsert({
        where: { budgetId_slotNumber: { budgetId, slotNumber: s.slotNumber } },
        create: { budgetId, ...s },
        update: { grantYear: s.grantYear, periodFrom: s.periodFrom, periodTo: s.periodTo, dueDate: s.dueDate },
      })
    ),
  ]);

  revalidatePath(`/budget/${budgetId}`);
  revalidatePath("/admin");
}

// ── Partner: start or update a report ─────────────────────────────────────────

async function assertCanEditReport(budgetId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  const budget = await prisma.budget.findUnique({ where: { id: budgetId }, select: { partnerId: true, grantPartnerId: true } });
  if (!budget) throw new Error("Not found");
  if (budget.partnerId === session.user.id || isSuperAdmin(session)) return session;
  // External grantee login: allowed when their linked org owns this budget.
  const access = await getPartnerAccess(session);
  if (partnerCanAccessBudget(access, budget)) return session;
  throw new Error("Forbidden");
}

export async function saveReport(
  slotId: string,
  data: {
    openingBalance?: number;
    tranchesReceived?: number;
    interestEarned?: number;
    bankBalance?: number;
    fdBalance?: number;
    cashInHand?: number;
    advances?: number;
    receivables?: number;
    payables?: number;
    partnerNotes?: string;
    bankStatementUrl?: string;
    bankStatementParsed?: object;
  }
) {
  const slot = await prisma.budgetReportSlot.findUnique({
    where: { id: slotId },
    select: { budgetId: true, status: true },
  });
  if (!slot) throw new Error("Slot not found");
  if (slot.status === "approved") throw new Error("Cannot edit an approved report");

  await assertCanEditReport(slot.budgetId);

  await prisma.budgetReport.upsert({
    where: { slotId },
    create: { slotId, budgetId: slot.budgetId, ...data },
    update: data,
  });

  revalidatePath(`/budget/${slot.budgetId}/reports/${slotId}`);
}

export async function saveReportLines(
  slotId: string,
  lines: Array<{ budgetLineId: string; actualAmount: number; notes?: string }>
) {
  const slot = await prisma.budgetReportSlot.findUnique({
    where: { id: slotId },
    select: { budgetId: true, status: true, report: { select: { id: true } } },
  });
  if (!slot) throw new Error("Slot not found");
  if (slot.status === "approved") throw new Error("Cannot edit an approved report");

  await assertCanEditReport(slot.budgetId);

  // Ensure report record exists
  const report = await prisma.budgetReport.upsert({
    where: { slotId },
    create: { slotId, budgetId: slot.budgetId },
    update: {},
    select: { id: true },
  });

  await Promise.all(
    lines.map(l =>
      prisma.budgetReportLine.upsert({
        where: { reportId_budgetLineId: { reportId: report.id, budgetLineId: l.budgetLineId } },
        create: { reportId: report.id, budgetLineId: l.budgetLineId, actualAmount: l.actualAmount, notes: l.notes },
        update: { actualAmount: l.actualAmount, notes: l.notes },
      })
    )
  );

  revalidatePath(`/budget/${slot.budgetId}/reports/${slotId}`);
}

type SubmitSlot = {
  budgetId: string; status: string; grantYear: number; slotNumber: number;
  report: { id: string; lines: { budgetLineId: string; actualAmount: number }[] } | null;
};

const SUBMIT_SLOT_SELECT = {
  budgetId: true, status: true, grantYear: true, slotNumber: true,
  report: { select: { id: true, lines: { select: { budgetLineId: true, actualAmount: true } } } },
} as const;

type YearTotals = { y1Total: number; y2Total: number; y3Total: number; y4Total: number; y5Total: number };

const yearTotalOf = (line: YearTotals, grantYear: number) =>
  grantYear === 1 ? line.y1Total
  : grantYear === 2 ? line.y2Total
  : grantYear === 3 ? line.y3Total
  : grantYear === 4 ? line.y4Total
  : line.y5Total;

// Actuals spent against a line earlier in the same grant year. Scoped to the
// year because it is compared with one year's budget, and slotNumber runs across
// the whole grant — an unscoped sum would charge earlier years' spending here.
async function priorActualsInYear(budgetId: string, grantYear: number, beforeSlotNumber: number) {
  const priorSlots = await prisma.budgetReportSlot.findMany({
    where: { budgetId, grantYear, slotNumber: { lt: beforeSlotNumber }, status: { in: ["approved", "submitted"] } },
    select: { report: { select: { lines: { select: { budgetLineId: true, actualAmount: true } } } } },
  });
  const totals: Record<string, number> = {};
  for (const ps of priorSlots) {
    for (const l of ps.report?.lines ?? []) {
      totals[l.budgetLineId] = (totals[l.budgetLineId] ?? 0) + l.actualAmount;
    }
  }
  return totals;
}

// Recompute sustain checks on all pending reallocation requests for this report.
async function recomputeSustainForSubmit(slot: SubmitSlot) {
  if (!slot.report) return;
  const requests = await prisma.budgetReallocationRequest.findMany({
    where: { reportId: slot.report.id, status: "pending" },
  });
  if (requests.length === 0) return;

  const priorActuals = await priorActualsInYear(slot.budgetId, slot.grantYear, slot.slotNumber);
  const currentActuals: Record<string, number> = Object.fromEntries(
    (slot.report.lines ?? []).map(l => [l.budgetLineId, l.actualAmount])
  );

  await Promise.all(requests.map(async req => {
    const fromLine = await prisma.budgetLine.findUnique({ where: { id: req.fromLineId } });
    if (!fromLine) return;
    // Money always comes out of the year it went unspent in, even when the
    // partner is asking to carry it into a later one.
    const yearTotal = yearTotalOf(fromLine, slot.grantYear);
    const ytdActual = (priorActuals[req.fromLineId] ?? 0) + (currentActuals[req.fromLineId] ?? 0);
    const sourceUnspent = Math.max(0, yearTotal - ytdActual);
    const willSustain = sourceUnspent >= req.requestedAmount;
    const sustainNote = willSustain ? null
      : `Source line has only ₹${Math.round(sourceUnspent).toLocaleString("en-IN")} unspent in Year ${slot.grantYear} vs requested ₹${Math.round(req.requestedAmount).toLocaleString("en-IN")}`;
    await prisma.budgetReallocationRequest.update({
      where: { id: req.id },
      data: { sourceUnspent, willSustain, sustainNote },
    });
  }));
}

// Submit gated by the Finance Declaration: the partner has affirmed the
// declaration and uploaded the signed+sealed scan. We freeze exactly what was
// affirmed (snapshot + hash) plus the audit trail (who / when / IP / UA).
export async function submitReportWithDeclaration(
  slotId: string,
  inputs: DeclarationInputs,
  signedScanUrl: string,
) {
  if (!signedScanUrl?.trim()) throw new Error("Please upload the signed & sealed declaration before submitting.");
  if (!declarationInputsComplete(inputs)) throw new Error("Please complete all declaration fields.");

  const slot = await prisma.budgetReportSlot.findUnique({ where: { id: slotId }, select: SUBMIT_SLOT_SELECT });
  if (!slot) throw new Error("Not found");
  if (!["pending", "sent_back"].includes(slot.status)) throw new Error("Cannot submit in current status");

  const session = await assertCanEditReport(slot.budgetId);

  const data = await computeDeclarationData(slotId);
  if (!data) throw new Error("Could not compute declaration figures");

  const snapshot = {
    affirmedAt: new Date().toISOString(),
    affirmedBy: { id: session.user!.id, name: session.user!.name ?? null, email: session.user!.email ?? null },
    grantId: inputs.grantId,
    period: { from: data.periodFrom.toISOString(), to: data.periodTo.toISOString() },
    grantYear: data.grantYear,
    slotNumber: data.slotNumber,
    inputs,
    summary: data.summary,
    unspent: data.unspent,
    affirmationClauses: AFFIRMATION_CLAUSES,
  };
  const hash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");

  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || null;
  const userAgent = h.get("user-agent");

  await recomputeSustainForSubmit(slot);

  await prisma.$transaction([
    prisma.budgetReportSlot.update({ where: { id: slotId }, data: { status: "submitted" } }),
    prisma.budgetReport.update({
      where: { slotId },
      data: {
        submittedAt: new Date(),
        declarationAcceptedAt: new Date(),
        declarationAcceptedById: session.user!.id,
        declarationSnapshot: snapshot,
        declarationHash: hash,
        declarationIp: ip,
        declarationUserAgent: userAgent,
        declarationSignedScanUrl: signedScanUrl.trim(),
      },
    }),
  ]);

  revalidatePath(`/budget/${slot.budgetId}/reports`);
  redirect(`/budget/${slot.budgetId}/reports`);
}

// ── FD details schedule (APF "Format for FD details") ─────────────────────────

export type FdRowInput = {
  bankName?: string; fdrNumber?: string;
  faceValue?: number; maturityValue?: number; cumulative?: boolean;
  doi?: string | null; dom?: string | null; roi?: number;
  openingBalance?: number; interestAccrued?: number; tds?: number;
  interestReceived?: number; maturedAmount?: number;
  maturityDate?: string | null; closingBalance?: number;
};

const toDate = (s?: string | null) => (s ? new Date(s) : null);
const toNum = (n?: number) => (Number.isFinite(n) ? (n as number) : 0);

export async function saveReportFds(slotId: string, rows: FdRowInput[]) {
  const slot = await prisma.budgetReportSlot.findUnique({
    where: { id: slotId },
    select: { budgetId: true, status: true },
  });
  if (!slot) throw new Error("Slot not found");
  if (slot.status === "approved") throw new Error("Cannot edit an approved report");
  await assertCanEditReport(slot.budgetId);

  const report = await prisma.budgetReport.upsert({
    where: { slotId },
    create: { slotId, budgetId: slot.budgetId },
    update: {},
    select: { id: true },
  });

  const fdBalance = rows.reduce((s, r) => s + toNum(r.closingBalance), 0);

  await prisma.$transaction([
    prisma.budgetReportFd.deleteMany({ where: { reportId: report.id } }),
    ...rows.map((r, i) =>
      prisma.budgetReportFd.create({
        data: {
          reportId: report.id,
          sortOrder: i,
          bankName: r.bankName ?? "",
          fdrNumber: r.fdrNumber ?? "",
          faceValue: toNum(r.faceValue),
          maturityValue: toNum(r.maturityValue),
          cumulative: r.cumulative ?? true,
          doi: toDate(r.doi),
          dom: toDate(r.dom),
          roi: toNum(r.roi),
          openingBalance: toNum(r.openingBalance),
          interestAccrued: toNum(r.interestAccrued),
          tds: toNum(r.tds),
          interestReceived: toNum(r.interestReceived),
          maturedAmount: toNum(r.maturedAmount),
          maturityDate: toDate(r.maturityDate),
          closingBalance: toNum(r.closingBalance),
        },
      })
    ),
    // Keep the reconciliation FD line in sync with the schedule.
    prisma.budgetReport.update({ where: { slotId }, data: { fdBalance } }),
  ]);

  revalidatePath(`/budget/${slot.budgetId}/reports/${slotId}`);
}

// ── Admin: review actions ──────────────────────────────────────────────────────

export async function approveReport(slotId: string) {
  const session = await auth();
  if (!session?.user || !isBudgetAdminOrSuperAdmin(session)) throw new Error("Unauthorized");

  const slot = await prisma.budgetReportSlot.findUnique({
    where: { id: slotId },
    select: { budgetId: true, status: true },
  });
  if (!slot || slot.status !== "submitted") throw new Error("Not in submitted state");

  // Block if any reallocation requests are still pending
  const report = await prisma.budgetReport.findUnique({ where: { slotId }, select: { id: true } });
  if (report) {
    const pendingReallocations = await prisma.budgetReallocationRequest.count({
      where: { reportId: report.id, status: "pending" },
    });
    if (pendingReallocations > 0) throw new Error(`${pendingReallocations} reallocation request(s) still pending — resolve them before approving.`);

    // Create new BudgetLines for approved reallocations where toLineId is null
    const approvedNewLines = await prisma.budgetReallocationRequest.findMany({
      where: { reportId: report.id, status: "approved", toLineId: null, createdLineId: null },
      select: { id: true, toDescription: true, toSection: true, approvedAmount: true },
    });
    if (approvedNewLines.length > 0) {
      const maxPos = await prisma.budgetLine.aggregate({ where: { budgetId: slot.budgetId }, _max: { position: true } });
      let pos = (maxPos._max.position ?? 0) + 1;
      await Promise.all(approvedNewLines.map(async req => {
        if (!req.toDescription || !req.toSection) return;
        const newLine = await prisma.budgetLine.create({
          data: {
            budgetId: slot.budgetId,
            section: req.toSection,
            position: pos++,
            description: req.toDescription,
            costCategory: "Other",
            isAutoGenerated: false,
            isReallocation: true,
            sourceReallocationId: req.id,
            y1Total: req.approvedAmount ?? 0,
          },
        });
        await prisma.budgetReallocationRequest.update({ where: { id: req.id }, data: { createdLineId: newLine.id } });
      }));
    }
  }

  // Auto-fill opening balance for next pending slot
  const reportFull = await prisma.budgetReport.findUnique({ where: { slotId }, select: { id: true, openingBalance: true, tranchesReceived: true, interestEarned: true } });
  if (reportFull) {
    const totalIncome = reportFull.openingBalance + reportFull.tranchesReceived + reportFull.interestEarned;
    const totalActuals = await prisma.budgetReportLine.aggregate({ where: { reportId: reportFull.id }, _sum: { actualAmount: true } });
    const closingBalance = totalIncome - (totalActuals._sum.actualAmount ?? 0);

    // Find next slot and pre-fill opening balance
    const currentSlot = await prisma.budgetReportSlot.findUnique({ where: { id: slotId }, select: { slotNumber: true } });
    if (currentSlot) {
      const nextSlot = await prisma.budgetReportSlot.findUnique({
        where: { budgetId_slotNumber: { budgetId: slot.budgetId, slotNumber: currentSlot.slotNumber + 1 } },
        select: { id: true, status: true },
      });
      if (nextSlot && nextSlot.status === "pending") {
        await prisma.budgetReport.upsert({
          where: { slotId: nextSlot.id },
          create: { slotId: nextSlot.id, budgetId: slot.budgetId, openingBalance: closingBalance },
          update: { openingBalance: closingBalance },
        });
      }
    }
  }

  await prisma.$transaction([
    prisma.budgetReportSlot.update({ where: { id: slotId }, data: { status: "approved" } }),
    prisma.budgetReport.update({ where: { slotId }, data: { approvedAt: new Date() } }),
  ]);

  revalidatePath(`/budget/${slot.budgetId}/reports`);
  revalidatePath("/admin");
}

// ── Line-level queries ────────────────────────────────────────────────────────

// A query thread runs across the send-back: the reviewer raises it on a
// submitted report, the partner answers it on the returned one.
const NOTE_OPEN_STATUSES = ["submitted", "sent_back"];

export async function addReportLineNote(slotId: string, budgetLineId: string, body: string) {
  const text = body.trim();
  if (!text) throw new Error("Write something first.");

  const slot = await prisma.budgetReportSlot.findUnique({
    where: { id: slotId },
    select: { budgetId: true, status: true },
  });
  if (!slot) throw new Error("Slot not found");
  if (!NOTE_OPEN_STATUSES.includes(slot.status)) throw new Error("This report is closed for comments.");

  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  // Either side of the conversation may post; the reviewer is not necessarily
  // able to edit the report, and the partner is not an admin.
  if (!isBudgetAdminOrSuperAdmin(session)) await assertCanEditReport(slot.budgetId);

  const report = await prisma.budgetReport.upsert({
    where: { slotId },
    create: { slotId, budgetId: slot.budgetId },
    update: {},
    select: { id: true },
  });

  await prisma.budgetReportLineNote.create({
    data: { reportId: report.id, budgetLineId, body: text, authorId: session.user.id! },
  });

  revalidatePath(`/budget/${slot.budgetId}/reports/${slotId}`);
}

export async function setReportLineNoteResolved(noteId: string, resolved: boolean) {
  const session = await auth();
  if (!session?.user || !isBudgetAdminOrSuperAdmin(session)) throw new Error("Unauthorized");

  const note = await prisma.budgetReportLineNote.findUnique({
    where: { id: noteId },
    select: { report: { select: { slotId: true, budgetId: true } } },
  });
  if (!note) throw new Error("Not found");

  await prisma.budgetReportLineNote.update({
    where: { id: noteId },
    data: {
      resolvedAt: resolved ? new Date() : null,
      resolvedById: resolved ? session.user.id! : null,
    },
  });

  revalidatePath(`/budget/${note.report.budgetId}/reports/${note.report.slotId}`);
}

export async function sendBackReport(slotId: string, reviewerNotes: string) {
  const session = await auth();
  if (!session?.user || !isBudgetAdminOrSuperAdmin(session)) throw new Error("Unauthorized");

  const slot = await prisma.budgetReportSlot.findUnique({
    where: { id: slotId },
    select: { budgetId: true, status: true },
  });
  if (!slot || slot.status !== "submitted") throw new Error("Not in submitted state");

  await prisma.$transaction([
    prisma.budgetReportSlot.update({ where: { id: slotId }, data: { status: "sent_back" } }),
    prisma.budgetReport.update({ where: { slotId }, data: { reviewerNotes } }),
  ]);

  revalidatePath(`/budget/${slot.budgetId}/reports`);
}

// ── Reallocation requests ─────────────────────────────────────────────────────

export async function addReallocationRequest(
  slotId: string,
  req: {
    fromLineId: string;
    toLineId: string | null;
    toDescription?: string;
    toSection?: BudgetSection;
    requestedAmount: number;
    durationType: ReallocationDuration;
    durationMonths?: number;
    targetGrantYear?: number | null;
    rationale: string;
  }
) {
  const slot = await prisma.budgetReportSlot.findUnique({
    where: { id: slotId },
    select: { budgetId: true, status: true, grantYear: true, slotNumber: true, budget: { select: { years: true } } },
  });
  if (!slot) throw new Error("Slot not found");
  if (!["pending", "sent_back"].includes(slot.status)) throw new Error("Cannot add requests in current status");
  await assertCanEditReport(slot.budgetId);

  // Carrying money backwards is not a reallocation — an earlier year is already
  // reported and its declaration signed.
  const targetGrantYear = req.targetGrantYear ?? null;
  if (targetGrantYear !== null) {
    if (targetGrantYear <= slot.grantYear) throw new Error("Carry-forward must target a later grant year.");
    if (targetGrantYear > slot.budget.years) throw new Error(`This grant ends at Year ${slot.budget.years}.`);
  }

  // Ensure report exists
  const report = await prisma.budgetReport.upsert({
    where: { slotId },
    create: { slotId, budgetId: slot.budgetId },
    update: {},
    select: { id: true, lines: { select: { budgetLineId: true, actualAmount: true } } },
  });

  // Compute sustain check
  const priorActuals = await priorActualsInYear(slot.budgetId, slot.grantYear, slot.slotNumber);
  const currentActuals: Record<string, number> = Object.fromEntries(report.lines.map(l => [l.budgetLineId, l.actualAmount]));
  const fromLine = await prisma.budgetLine.findUnique({ where: { id: req.fromLineId } });
  if (!fromLine) throw new Error("Source line not found");
  const yearTotal = yearTotalOf(fromLine, slot.grantYear);
  const ytdActual = (priorActuals[req.fromLineId] ?? 0) + (currentActuals[req.fromLineId] ?? 0);
  const sourceUnspent = Math.max(0, yearTotal - ytdActual);
  const willSustain = sourceUnspent >= req.requestedAmount;
  const sustainNote = willSustain ? null
    : `Source line has only ₹${Math.round(sourceUnspent).toLocaleString("en-IN")} unspent in Year ${slot.grantYear} vs requested ₹${Math.round(req.requestedAmount).toLocaleString("en-IN")}`;

  const isRecurring = req.durationType !== "one_time";
  const durationMonths = req.durationMonths ?? null;
  const monthlyAmount = isRecurring && durationMonths ? req.requestedAmount / durationMonths : 0;

  await prisma.budgetReallocationRequest.create({
    data: {
      reportId: report.id,
      fromLineId: req.fromLineId,
      toLineId: req.toLineId,
      toDescription: req.toDescription ?? null,
      toSection: req.toSection ?? null,
      requestedAmount: req.requestedAmount,
      isRecurring,
      monthlyAmount,
      durationType: req.durationType,
      durationMonths,
      targetGrantYear,
      rationale: req.rationale,
      sourceUnspent,
      willSustain,
      sustainNote,
    },
  });

  revalidatePath(`/budget/${slot.budgetId}/reports/${slotId}`);
}

export async function deleteReallocationRequest(requestId: string) {
  const req = await prisma.budgetReallocationRequest.findUnique({
    where: { id: requestId },
    select: { status: true, report: { select: { slotId: true, slot: { select: { budgetId: true, status: true } } } } },
  });
  if (!req) throw new Error("Not found");
  if (req.status !== "pending") throw new Error("Cannot delete a resolved request");
  if (!["pending", "sent_back"].includes(req.report.slot.status)) throw new Error("Cannot delete in current status");
  await assertCanEditReport(req.report.slot.budgetId);

  await prisma.budgetReallocationRequest.delete({ where: { id: requestId } });
  revalidatePath(`/budget/${req.report.slot.budgetId}/reports/${req.report.slotId}`);
}

export async function resolveReallocationRequest(
  requestId: string,
  resolution: { status: "approved" | "rejected"; approvedAmount?: number; reviewerComment?: string }
) {
  const session = await auth();
  if (!session?.user || !isBudgetAdminOrSuperAdmin(session)) throw new Error("Unauthorized");

  const req = await prisma.budgetReallocationRequest.findUnique({
    where: { id: requestId },
    select: { status: true, report: { select: { slotId: true, slot: { select: { budgetId: true, status: true } } } } },
  });
  if (!req) throw new Error("Not found");
  if (req.status !== "pending") throw new Error("Already resolved");
  if (req.report.slot.status !== "submitted") throw new Error("Report not in submitted state");

  await prisma.budgetReallocationRequest.update({
    where: { id: requestId },
    data: {
      status: resolution.status,
      approvedAmount: resolution.status === "approved" ? (resolution.approvedAmount ?? null) : null,
      reviewerComment: resolution.reviewerComment ?? null,
      resolvedAt: new Date(),
    },
  });

  revalidatePath(`/budget/${req.report.slot.budgetId}/reports/${req.report.slotId}`);
}
