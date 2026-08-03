import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import PartnerBudgetEditor from "./PartnerBudgetEditor";
import { canAccessBudget } from "@/lib/budget/budgetAccess";
import { getPartnerAccess, partnerCanAccessBudget } from "@/lib/budget/partnerAccess";
import { buildWorkingByLineId } from "@/lib/budget/lineWorking";
import { listBudgetLineNotes, type DraftNote } from "../../partner-draft-actions";

// The grantee's route into a draft the lead shared with them. Deliberately not
// /budget/[id]: that is the manage view, and its payload carries internal
// colleagues' names and emails. Nothing internal is assembled here.
export default async function PartnerDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const budget = await prisma.budget.findUnique({
    where: { id },
    include: {
      inputs: true,
      lines: { orderBy: { position: "asc" }, include: { components: { orderBy: { position: "asc" } } } },
    },
  });
  if (!budget) notFound();

  const access = await getPartnerAccess(session);
  const isGrantee = partnerCanAccessBudget(access, budget);
  // A lead may open the same view to see exactly what the grantee sees; they just
  // can't write through it (withBudgetLineWrite still decides that server-side).
  if (!isGrantee && !(await canAccessBudget(session, budget, "update"))) notFound();
  // Nothing to show until the lead has actually shared it.
  if (budget.partnerEditState === "closed") notFound();

  const workingByLineId = await buildWorkingByLineId(budget.city, budget.lines);

  const domainConfigs = await prisma.budgetDomainConfig.findMany({
    where: { city: budget.city },
    select: { key: true, label: true },
  });
  const domainLabels = Object.fromEntries(domainConfigs.map(d => [d.key, d.label]));

  const notes = await listBudgetLineNotes(id);
  // A null line is a send-back note on the budget as a whole; the rest are the
  // lead's queries against individual lines.
  const leadNotes = notes.filter(n => n.budgetLineId === null);
  const notesByLine: Record<string, DraftNote[]> = {};
  for (const n of notes) {
    if (n.budgetLineId) (notesByLine[n.budgetLineId] ??= []).push(n);
  }

  const { partnerBaseline, ...rest } = budget;
  const serialized = JSON.parse(JSON.stringify(rest));

  return (
    <PartnerBudgetEditor
      budget={{ ...serialized, domainLabels, workingByLineId }}
      notes={leadNotes}
      notesByLine={notesByLine}
      editable={isGrantee && budget.status === "draft" && budget.partnerEditState === "open"}
    />
  );
}
