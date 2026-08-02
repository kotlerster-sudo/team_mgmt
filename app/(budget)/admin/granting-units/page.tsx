import { auth } from "@/lib/auth";
import { isBudgetAdminOrSuperAdmin } from "@/lib/roleGuard";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { GLOBAL_SCOPE } from "@/lib/budget/costRegistry";
import GrantingUnitsClient from "./GrantingUnitsClient";

export default async function GrantingUnitsPage() {
  const session = await auth();
  if (!session?.user || !isBudgetAdminOrSuperAdmin(session)) redirect("/budget");

  const [units, registryCities] = await Promise.all([
    prisma.grantingUnit.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true, name: true, kind: true, registryCity: true, isActive: true,
        _count: { select: { budgets: true, partners: true } },
      },
    }),
    // Only cities that actually carry standard cost data can back a unit. The
    // shared layer is excluded: it is what every unit already falls back to, so
    // pointing a unit at it would say nothing.
    prisma.costRegistry.findMany({
      where: { city: { not: GLOBAL_SCOPE } },
      distinct: ["city"], select: { city: true }, orderBy: { city: "asc" },
    }),
  ]);

  return (
    <GrantingUnitsClient
      units={units.map((u) => ({
        id: u.id, name: u.name, kind: u.kind, registryCity: u.registryCity, isActive: u.isActive,
        budgetCount: u._count.budgets, partnerCount: u._count.partners,
      }))}
      registryCities={registryCities.map((r) => r.city)}
    />
  );
}
