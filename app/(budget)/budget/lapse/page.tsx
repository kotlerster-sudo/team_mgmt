import { auth } from "@/lib/auth";
import { isBudgetAdminOrSuperAdmin } from "@/lib/roleGuard";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { partnerLapseRecords } from "@/lib/budget/lapse";
import { listGrantingUnits } from "@/lib/budget/grantingUnits";
import LapseView from "./LapseView";

export default async function LapsePage() {
  const session = await auth();
  if (!session?.user || !isBudgetAdminOrSuperAdmin(session)) redirect("/budget");

  const [records, domainConfigs, units] = await Promise.all([
    partnerLapseRecords(),
    prisma.budgetDomainConfig.findMany({ select: { key: true, label: true } }),
    listGrantingUnits(),
  ]);

  return (
    <LapseView
      records={records}
      domainLabels={Object.fromEntries(domainConfigs.map((d) => [d.key, d.label]))}
      units={units.map((u) => ({ id: u.id, name: u.name }))}
    />
  );
}
