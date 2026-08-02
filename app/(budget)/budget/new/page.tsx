import Link from "next/link";
import prisma from "@/lib/prisma";
import NewBudgetForm from "./NewBudgetForm";
import { refsInFormula } from "@/lib/formula/engine";
import { ENUM_PICKERS, ENUM_MANAGED_INPUT_KEYS, type EnumPicker } from "@/lib/budget/inputEnumOptions";

const FIXED_VARS = new Set(["fixed_1", "fixed_12", "cosTotal", ""]);

export type DomainInputField = {
  key: string;
  label: string;
  unit: string;
  defaultValue: number;
  isRent: boolean;
  // null  → truly cross-cutting (always shown, no domain reference)
  // []    → only shown when listed domains are selected. Form filters at render.
  requiredByDomains: string[] | null;
};

export type DomainOption = {
  key: string;
  label: string;
  description: string | null;
  city: string;
  inputs: DomainInputField[];
};

/** A unit cost or programme ratio the partner can customise per-budget. */
export type CostItem = {
  itemKey: string;
  domain: string | null;
  unit: string;
  defaultValue: number;
  label: string;
  /** "cost" if unit includes "₹" (monetary), else "ratio". Mirrors the admin
   *  CostRegistry split so the form can group the two visually. */
  kind: "cost" | "ratio";
};

export default async function NewBudgetPage({ searchParams }: { searchParams: Promise<{ city?: string }> }) {
  const initialCity = (await searchParams).city;
  const [domainRows, templateRows, inpRows, allCostRows] = await Promise.all([
    prisma.budgetDomainConfig.findMany({ where: { isActive: true }, orderBy: { position: "asc" } }),
    prisma.lineTemplate.findMany({
      where: { isActive: true },
      select: { city: true, domain: true, inputVar: true, userInputCost: true, formula: true },
    }),
    prisma.costRegistry.findMany({ where: { itemKey: { startsWith: "inp." } } }),
    // Full registry minus inp.* items — these are the unit costs + programme
    // ratios the customise accordion can edit.
    prisma.costRegistry.findMany({
      where: { NOT: { itemKey: { startsWith: "inp." } } },
      select: { itemKey: true, domain: true, unit: true, unitCost: true, notes: true },
    }),
  ]);

  // bare key → label/unit/defaultValue (programme-scale inputs)
  const inputMeta: Record<string, { label: string; unit: string; defaultValue: number }> = {};
  for (const r of inpRows) {
    const key = r.itemKey.slice(4); // strip "inp."
    inputMeta[key] = { label: r.notes ?? key, unit: r.unit, defaultValue: r.unitCost };
  }

  // Format an itemKey like "children.snack_per_child_per_day" → "snack per child per day"
  const formatLabel = (k: string) => k.split(".").slice(1).join(".").replace(/_/g, " ");

  const costItems: CostItem[] = allCostRows.map(r => ({
    itemKey: r.itemKey,
    domain: r.domain,
    unit: r.unit,
    defaultValue: r.unitCost,
    label: r.notes ?? formatLabel(r.itemKey),
    kind: r.unit.includes("₹") ? "cost" : "ratio",
  }));

  // Per (city:domain): deduplicated inp keys with isRent flag
  type KeyEntry = { key: string; isRent: boolean };
  const domainKeyMap: Record<string, Record<string, KeyEntry>> = {};
  const keyDomainCount: Record<string, Set<string>> = {};

  for (const t of templateRows) {
    if (!t.domain) continue;
    const slot = `${t.city}:${t.domain}`;
    if (!domainKeyMap[slot]) domainKeyMap[slot] = {};

    // No ALWAYS_CROSS_CUTTING filter here: nSettlements / nClusters / cosPerCluster
    // are picked up via the templates that actually need them (Welfare Rights,
    // Food, Sanitation Complex). The form gates cross-cutting visibility by
    // the requiredByDomains carried on each input, so single-domain CLC or YRC
    // budgets no longer see settlement / cluster prompts.
    const candidates: KeyEntry[] = [];
    if (t.inputVar && !FIXED_VARS.has(t.inputVar))
      candidates.push({ key: t.inputVar, isRent: false });
    if (t.userInputCost)
      candidates.push({ key: t.userInputCost, isRent: true });
    // Parametric templates reference inp.* directly inside the formula;
    // surface those as discovered inputs too so the form asks the user for them.
    if (t.formula) {
      for (const ref of refsInFormula(t.formula)) {
        if (ref.startsWith("inp.")) {
          const key = ref.slice(4);
          if (!ENUM_MANAGED_INPUT_KEYS.has(key)) candidates.push({ key, isRent: false });
        }
      }
    }

    for (const entry of candidates) {
      domainKeyMap[slot][entry.key] = entry;
      if (!keyDomainCount[entry.key]) keyDomainCount[entry.key] = new Set();
      keyDomainCount[entry.key].add(t.domain);
    }
  }

  const domains: DomainOption[] = domainRows.map(d => {
    const slot = `${d.city}:${d.key}`;
    const inputs: DomainInputField[] = Object.values(domainKeyMap[slot] ?? {})
      .filter(e => (keyDomainCount[e.key]?.size ?? 0) < 2 && inputMeta[e.key])
      .map(e => ({ key: e.key, isRent: e.isRent, requiredByDomains: [d.key], ...inputMeta[e.key] }));
    return { key: d.key, label: d.label, description: d.description, city: d.city, inputs };
  });

  // Cross-cutting = any key referenced by 2+ domains' templates. requiredByDomains
  // is the union of those domains so the form can hide an input when the user
  // hasn't selected any of its consuming domains. Inputs referenced by zero
  // templates are dropped: nothing in the generated lines would use them.
  const crossCuttingInputs: DomainInputField[] = Object.entries(keyDomainCount)
    .filter(([, s]) => s.size >= 2)
    .filter(([k]) => inputMeta[k])
    .map(([k, s]) => ({
      key: k, isRent: false, requiredByDomains: [...s],
      ...inputMeta[k],
    }));

  const partners = await prisma.grantPartner.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, city: true },
  });
  const cityQ = initialCity ? `?city=${encodeURIComponent(initialCity)}` : "";

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">New Budget</h1>
          <p className="text-sm text-stone-500 mt-1">Select domains and enter programme scale to auto-generate a draft budget.</p>
        </div>
        <Link
          href={`/budget/import${cityQ}`}
          className="shrink-0 text-sm border border-stone-300 text-stone-700 px-3 py-2 rounded-lg hover:bg-stone-50"
        >
          Import from Excel →
        </Link>
      </div>
      <NewBudgetForm domains={domains} crossCuttingInputs={crossCuttingInputs} costItems={costItems} initialCity={initialCity} partners={partners} enumPickers={ENUM_PICKERS as EnumPicker[]} />
    </div>
  );
}
