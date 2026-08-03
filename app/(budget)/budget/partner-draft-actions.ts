"use server";

// Grant-making stage: the lead shares a draft budget with the grantee, who edits
// it against their own reality and submits. The lead reviews the diff and either
// sends it back or takes the draft off them.
//
// Line writes are gated in lib/budget/budgetAccess.ts (withBudgetLineWrite).
// These four actions only move Budget.partnerEditState between closed / open /
// submitted, and are the reason that gate has anything to check.

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireBudgetAccess } from "@/lib/budget/budgetAccess";
import { getPartnerAccess, partnerCanAccessBudget } from "@/lib/budget/partnerAccess";
import { diffAgainstBaseline, workingSignature, type BaselineLine, type LineDiff } from "@/lib/budget/partnerDiff";
import { notifyDraftSentBack, notifyDraftShared, notifyDraftSubmitted } from "@/lib/budget/draftNotify";

/** The lines as the diff sees them. Used both to take the baseline at share
 *  time and to read the current state back at review time. */
async function snapshotLines(budgetId: string): Promise<BaselineLine[]> {
  const lines = await prisma.budgetLine.findMany({
    where: { budgetId },
    orderBy: { position: "asc" },
    select: {
      id: true, description: true, section: true, domain: true, unitType: true,
      y1Units: true, y1UnitCost: true, y1Total: true, derivation: true,
      components: { orderBy: { position: "asc" }, select: { label: true, spec: true, qty: true, unitCost: true } },
    },
  });
  return lines.map(l => ({
    id: l.id, description: l.description, section: l.section, domain: l.domain,
    unitType: l.unitType, y1Units: l.y1Units, y1UnitCost: l.y1UnitCost, y1Total: l.y1Total,
    derivation: l.derivation, workingSignature: workingSignature(l.components),
  }));
}

/** Internal caller managing this grant. Throws for a grantee login. */
async function requireManager(budgetId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  if (session.user.role === "partner") throw new Error("Forbidden");
  const budget = await prisma.budget.findUnique({
    where: { id: budgetId },
    select: { id: true, name: true, partnerId: true, grantPartnerId: true, status: true, partnerEditState: true, partnerRound: true, grantLeadId: true },
  });
  await requireBudgetAccess(session, budget, "update");
  if (!budget) throw new Error("Not found");
  return { session, budget };
}

/** The grantee this budget was granted to. Throws for anyone else. */
async function requireGrantee(budgetId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  const budget = await prisma.budget.findUnique({
    where: { id: budgetId },
    select: {
      id: true, name: true, grantPartnerId: true, status: true, partnerEditState: true,
      partnerRound: true, grantLeadId: true,
      grantPartner: { select: { name: true } },
    },
  });
  if (!budget) throw new Error("Not found");
  const access = await getPartnerAccess(session);
  if (!partnerCanAccessBudget(access, budget)) throw new Error("Forbidden");
  return { session, budget };
}

/** Open the draft for the grantee to edit, snapshotting the lines as the basis
 *  for the review diff. */
export async function shareBudgetWithPartner(budgetId: string) {
  const { budget } = await requireManager(budgetId);
  if (budget.status !== "draft") throw new Error("Only a draft can be shared — this budget is already finalised or approved.");
  if (!budget.grantPartnerId) throw new Error("Link a grantee org to this budget before sharing it.");
  if (budget.partnerEditState === "open") return;

  const baseline = await snapshotLines(budgetId);
  await prisma.budget.update({
    where: { id: budgetId },
    data: {
      partnerEditState: "open",
      partnerSharedAt: new Date(),
      partnerSubmittedAt: null,
      partnerBaseline: baseline,
    },
  });
  await notifyDraftShared(budget);
  revalidatePath(`/budget/${budgetId}`);
}

/** Grantee hands the draft back. Locks their writes. */
export async function submitBudgetDraft(budgetId: string) {
  const { budget } = await requireGrantee(budgetId);
  if (budget.partnerEditState !== "open") throw new Error("This budget isn't open for your input.");

  await prisma.budget.update({
    where: { id: budgetId },
    data: { partnerEditState: "submitted", partnerSubmittedAt: new Date() },
  });
  await notifyDraftSubmitted(budget, budget.grantPartner?.name ?? null);
  revalidatePath("/budget");
  revalidatePath(`/budget/${budgetId}/draft`);
}

/** Lead returns the draft for another round. The round counter keeps each
 *  iteration's line notes distinguishable. */
export async function sendBackBudgetDraft(budgetId: string, note: string) {
  const { session, budget } = await requireManager(budgetId);
  if (budget.partnerEditState !== "submitted") throw new Error("This draft isn't awaiting your review.");
  const body = note.trim();
  if (!body) throw new Error("Say what needs changing before sending it back.");

  const round = budget.partnerRound + 1;
  await prisma.$transaction([
    prisma.budget.update({
      where: { id: budgetId },
      data: { partnerEditState: "open", partnerRound: round, partnerSubmittedAt: null },
    }),
    // budgetLineId null = a note on the budget as a whole, not one line.
    prisma.budgetLineNote.create({
      data: { budgetId, budgetLineId: null, round, body, authorId: session.user!.id },
    }),
  ]);
  await notifyDraftSentBack(budget, body);
  revalidatePath(`/budget/${budgetId}`);
}

/** Lead takes the draft back — ends grantee write access. The precondition on
 *  finalise and approve, and the way out of a draft the grantee never returns. */
export async function reclaimBudgetDraft(budgetId: string) {
  const { budget } = await requireManager(budgetId);
  if (budget.partnerEditState === "closed") return;

  await prisma.budget.update({ where: { id: budgetId }, data: { partnerEditState: "closed" } });
  revalidatePath(`/budget/${budgetId}`);
}

// ── Line-level queries ────────────────────────────────────────────────────────

export type DraftNote = {
  id: string;
  budgetLineId: string | null;
  round: number;
  body: string;
  createdAt: string;
  resolvedAt: string | null;
  authorName: string;
};

const NOTE_SELECT = {
  id: true, budgetLineId: true, round: true, body: true,
  createdAt: true, resolvedAt: true,
  author: { select: { name: true, email: true } },
} as const;

type NoteRow = {
  id: string; budgetLineId: string | null; round: number; body: string;
  createdAt: Date; resolvedAt: Date | null; author: { name: string | null; email: string };
};

function toDraftNote(n: NoteRow): DraftNote {
  return {
    id: n.id, budgetLineId: n.budgetLineId, round: n.round, body: n.body,
    createdAt: n.createdAt.toISOString(),
    resolvedAt: n.resolvedAt?.toISOString() ?? null,
    authorName: n.author.name ?? n.author.email,
  };
}

/** Either side of the conversation. The lead raises a query off the review diff
 *  and the grantee answers it inline on the line, so both may post. */
async function requireDraftParticipant(budgetId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  const budget = await prisma.budget.findUnique({
    where: { id: budgetId },
    select: { id: true, partnerId: true, grantPartnerId: true, status: true, partnerEditState: true, partnerRound: true },
  });
  if (!budget) throw new Error("Not found");

  if (session.user.role === "partner") {
    const access = await getPartnerAccess(session);
    if (!partnerCanAccessBudget(access, budget)) throw new Error("Forbidden");
    return { session, budget, isManager: false };
  }
  await requireBudgetAccess(session, budget, "update");
  return { session, budget, isManager: true };
}

/** Raise or answer a query on one line. Open for as long as the draft is out
 *  with the grantee — including while submitted, which is when the lead reads
 *  it and objects. */
export async function addBudgetLineNote(budgetId: string, budgetLineId: string, body: string): Promise<DraftNote> {
  const text = body.trim();
  if (!text) throw new Error("Write something first.");
  const { session, budget } = await requireDraftParticipant(budgetId);
  if (budget.partnerEditState === "closed") throw new Error("This draft is closed for comments.");

  const line = await prisma.budgetLine.findUnique({ where: { id: budgetLineId }, select: { budgetId: true } });
  if (line?.budgetId !== budgetId) throw new Error("Not found");

  const note = await prisma.budgetLineNote.create({
    data: { budgetId, budgetLineId, round: budget.partnerRound, body: text, authorId: session.user!.id! },
    select: NOTE_SELECT,
  });
  revalidatePath(`/budget/${budgetId}`);
  revalidatePath(`/budget/${budgetId}/draft`);
  return toDraftNote(note);
}

/** Closing out a query is the lead's call — the grantee answering it is not the
 *  same as the lead being satisfied. */
export async function setBudgetLineNoteResolved(noteId: string, resolved: boolean): Promise<DraftNote> {
  const existing = await prisma.budgetLineNote.findUnique({ where: { id: noteId }, select: { budgetId: true } });
  if (!existing) throw new Error("Not found");
  const { session, isManager } = await requireDraftParticipant(existing.budgetId);
  if (!isManager) throw new Error("Forbidden");

  const note = await prisma.budgetLineNote.update({
    where: { id: noteId },
    data: {
      resolvedAt: resolved ? new Date() : null,
      resolvedById: resolved ? session.user!.id! : null,
    },
    select: NOTE_SELECT,
  });
  revalidatePath(`/budget/${existing.budgetId}`);
  revalidatePath(`/budget/${existing.budgetId}/draft`);
  return toDraftNote(note);
}

/** Every note on this budget, oldest first — threads read top to bottom. */
export async function listBudgetLineNotes(budgetId: string): Promise<DraftNote[]> {
  await requireDraftParticipant(budgetId);
  const notes = await prisma.budgetLineNote.findMany({
    where: { budgetId },
    orderBy: { createdAt: "asc" },
    select: NOTE_SELECT,
  });
  return notes.map(toDraftNote);
}

/** What the grantee changed since the draft was shared. Null when it has never
 *  been shared, so the review panel can stay hidden. */
export async function getPartnerDraftDiff(budgetId: string): Promise<LineDiff | null> {
  await requireManager(budgetId);
  const raw = await prisma.budget.findUnique({ where: { id: budgetId }, select: { partnerBaseline: true } });
  const baseline = raw?.partnerBaseline;
  if (!Array.isArray(baseline)) return null;
  return diffAgainstBaseline(baseline as unknown as BaselineLine[], await snapshotLines(budgetId));
}
