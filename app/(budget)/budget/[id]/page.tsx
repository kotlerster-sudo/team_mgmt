import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import BudgetEditor from "./BudgetEditor";
import { canAccessBudget } from "@/lib/budget/budgetAccess";
import { resolveRegistryCity } from "@/lib/budget/grantingUnits";

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

  if (!(await canAccessBudget(session, budget, "read"))) notFound();
  if (!budget) notFound();

  // Per-line "working": the line's own components once authored, else a fallback
  // to the standard registry breakup (via the template's costKey). A unit with
  // no registry/templates of its own generates from its registryCity, so the
  // working must resolve against the same source (matches createBudget).
  const registryCity = await resolveRegistryCity(budget.city);
  const [tmpls, regComps, regItems] = await Promise.all([
    prisma.lineTemplate.findMany({ where: { city: registryCity }, select: { templateKey: true, costKey: true } }),
    prisma.costRegistryComponent.findMany({ where: { city: registryCity }, orderBy: { position: "asc" }, select: { parentItemKey: true, label: true, spec: true, qty: true, unitCost: true } }),
    prisma.costRegistry.findMany({ where: { city: registryCity }, select: { itemKey: true, derivation: true } }),
  ]);
  const costKeyByTemplate = new Map(tmpls.map(t => [t.templateKey, t.costKey]));
  const regCompByKey: Record<string, { label: string; spec: string | null; qty: number; unitCost: number }[]> = {};
  for (const c of regComps) (regCompByKey[c.parentItemKey] ??= []).push({ label: c.label, spec: c.spec, qty: c.qty, unitCost: c.unitCost });
  const regDerivByKey = new Map(regItems.map(r => [r.itemKey, r.derivation]));

  // customised = edited on this budget (a budget-specific override).
  // frozen = the components are a snapshot captured at generation (point-in-time)
  // vs a live registry fallback (older budgets with no snapshot).
  type Working = { components: { label: string; spec: string | null; qty: number; unitCost: number }[]; derivation: string | null; customised: boolean; frozen: boolean };
  const workingByLineId: Record<string, Working> = {};
  for (const l of budget.lines) {
    if (l.components.length > 0) {
      workingByLineId[l.id] = { components: l.components.map(c => ({ label: c.label, spec: c.spec, qty: c.qty, unitCost: c.unitCost })), derivation: l.derivation ?? null, customised: l.workingCustomised, frozen: true };
    } else {
      const costKey = l.templateKey ? costKeyByTemplate.get(l.templateKey) ?? null : null;
      workingByLineId[l.id] = {
        components: costKey ? (regCompByKey[costKey] ?? []) : [],
        derivation: (costKey ? regDerivByKey.get(costKey) : null) ?? l.derivation ?? null,
        customised: false,
        frozen: false,
      };
    }
  }

  // Load domain labels for this city so BudgetEditor can display them
  const domainConfigs = await prisma.budgetDomainConfig.findMany({
    where: { city: budget.city },
    select: { key: true, label: true },
  });
  const domainLabels = Object.fromEntries(domainConfigs.map(d => [d.key, d.label]));

  // Grantee orgs in this budget's city, for the assign-partner control.
  const grantPartners = await prisma.grantPartner.findMany({
    where: { city: budget.city, isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const serialized = JSON.parse(JSON.stringify(budget));
  return <BudgetEditor budget={{ ...serialized, domainLabels, grantPartners, workingByLineId }} />;
}
