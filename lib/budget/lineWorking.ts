// Per-line "working": the line's own component breakup once authored, else a
// fallback to the standard registry breakup (via the template's costKey). A unit
// with no registry/templates of its own generates from its registryCity, so the
// working must resolve against the same source (matches createBudget).

import prisma from "@/lib/prisma";
import { resolveRegistryCity } from "./grantingUnits";
import { resolveRegistryComponents, resolveRegistryRows } from "./costRegistry";

export type LineWorking = {
  components: { label: string; spec: string | null; qty: number; unitCost: number }[];
  derivation: string | null;
  /** Edited on this budget — a budget-specific override. */
  customised: boolean;
  /** Snapshot captured at generation, vs a live registry fallback (older budgets). */
  frozen: boolean;
};

type LineForWorking = {
  id: string;
  templateKey: string | null;
  derivation: string | null;
  workingCustomised: boolean;
  components: { label: string; spec: string | null; qty: number; unitCost: number }[];
};

export async function buildWorkingByLineId(city: string, lines: LineForWorking[]): Promise<Record<string, LineWorking>> {
  const registryCity = await resolveRegistryCity(city);
  const [tmpls, regCompByKey, regItems] = await Promise.all([
    prisma.lineTemplate.findMany({ where: { city: registryCity }, select: { templateKey: true, costKey: true } }),
    resolveRegistryComponents(registryCity),
    resolveRegistryRows(registryCity),
  ]);
  const costKeyByTemplate = new Map(tmpls.map(t => [t.templateKey, t.costKey]));
  const regDerivByKey = new Map(regItems.map(r => [r.itemKey, r.derivation]));

  const out: Record<string, LineWorking> = {};
  for (const l of lines) {
    if (l.components.length > 0) {
      out[l.id] = {
        components: l.components.map(c => ({ label: c.label, spec: c.spec, qty: c.qty, unitCost: c.unitCost })),
        derivation: l.derivation ?? null,
        customised: l.workingCustomised,
        frozen: true,
      };
    } else {
      const costKey = l.templateKey ? costKeyByTemplate.get(l.templateKey) ?? null : null;
      out[l.id] = {
        components: costKey ? (regCompByKey[costKey] ?? []) : [],
        derivation: (costKey ? regDerivByKey.get(costKey) : null) ?? l.derivation ?? null,
        customised: false,
        frozen: false,
      };
    }
  }
  return out;
}
