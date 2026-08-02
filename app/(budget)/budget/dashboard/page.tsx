import { auth } from "@/lib/auth";
import { isBudgetAdminOrSuperAdmin } from "@/lib/roleGuard";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { buildGrantRow, type BudgetForAgg } from "@/lib/budget/grantAggregation";
import DashboardView from "./DashboardView";
import { listGrantingUnits } from "@/lib/budget/grantingUnits";

export default async function GrantDashboardPage() {
  const session = await auth();
  if (!session?.user || !isBudgetAdminOrSuperAdmin(session)) redirect("/budget");

  const [budgets, domainConfigs, borrowings, units] = await Promise.all([
    prisma.budget.findMany({
      where: { status: "approved" },
      select: {
        id: true, name: true, city: true, status: true, horizonMonths: true, domains: true,
        grantPartnerId: true,
        grantPartner: { select: { id: true, name: true } },
        reportConfig: { select: { grantStartDate: true, grantEndDate: true } },
        lines: { select: { id: true, domain: true, y1Total: true, y2Total: true, y3Total: true, y4Total: true, y5Total: true } },
        reportSlots: { select: { status: true, report: { select: { lines: { select: { budgetLineId: true, actualAmount: true } } } } } },
      },
    }),
    prisma.budgetDomainConfig.findMany({ select: { key: true, label: true } }),
    prisma.grantBorrowing.findMany({
      select: {
        id: true, amount: true, borrowedOn: true, reason: true, status: true,
        fromBudget: { select: { id: true, name: true, city: true, grantPartner: { select: { name: true } } } },
        toBudget: { select: { id: true, name: true, city: true, grantPartner: { select: { name: true } } } },
        repayments: { select: { amount: true, repaidOn: true } },
      },
      orderBy: { borrowedOn: "desc" },
    }),
    listGrantingUnits(),
  ]);

  const grantRows = budgets.map((b) => buildGrantRow(b as unknown as BudgetForAgg));
  const domainLabels = Object.fromEntries(domainConfigs.map((d) => [d.key, d.label]));

  return (
    <DashboardView
      grants={grantRows}
      domainLabels={domainLabels}
      borrowings={JSON.parse(JSON.stringify(borrowings))}
      units={units.map((u) => ({ id: u.id, name: u.name }))}
    />
  );
}
