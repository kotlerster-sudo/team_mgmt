import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import BudgetEditor from "./BudgetEditor";
import { canAccessBudget } from "@/lib/budget/budgetAccess";
import { buildWorkingByLineId } from "@/lib/budget/lineWorking";
import { listBudgetLineNotes } from "../partner-draft-actions";

export default async function BudgetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const budget = await prisma.budget.findUnique({
    where: { id },
    include: {
      inputs: true,
      lines: { orderBy: { position: "asc" }, include: { components: { orderBy: { position: "asc" } } } },
      deliveryPartners: { orderBy: { sortOrder: "asc" } },
    },
  });

  // "update", not "read": this is the manage view. Partners hold budget.read on
  // their own org's budgets, and everything below — including every internal
  // user's name and email for the grant-lead picker — ships in the RSC payload.
  if (!(await canAccessBudget(session, budget, "update"))) notFound();
  if (!budget) notFound();

  const workingByLineId = await buildWorkingByLineId(budget.city, budget.lines);

  // Load domain labels for this city so BudgetEditor can display them
  const domainConfigs = await prisma.budgetDomainConfig.findMany({
    where: { city: budget.city },
    select: { key: true, label: true },
  });
  const domainLabels = Object.fromEntries(domainConfigs.map(d => [d.key, d.label]));

  const [grantPartners, grantLeads] = await Promise.all([
    // Grantee orgs in this budget's granting unit, for the assign-partner control.
    prisma.grantPartner.findMany({
      where: { city: budget.city, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    // Internal colleagues only — a grantee login must never be the grant lead.
    prisma.user.findMany({
      where: { role: { not: "partner" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
  ]);

  // partnerBaseline is the whole share-time line snapshot — server-side input to
  // the review diff, and no business being in the client payload.
  const { partnerBaseline, ...rest } = budget;
  const serialized = JSON.parse(JSON.stringify(rest));
  const grantPartnerName = grantPartners.find(p => p.id === budget.grantPartnerId)?.name ?? null;

  const notes = await listBudgetLineNotes(id);

  return <BudgetEditor budget={{ ...serialized, domainLabels, grantPartners, grantLeads, grantPartnerName, workingByLineId }} notes={notes} />;
}
