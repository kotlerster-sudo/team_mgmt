// Completion gating for a /field SETUP step's checklist form. Shared by the
// RP-facing modal (button enable/disable) and the step API route (hard guard).
//
//  • scored checklist — every NON-NEGOTIABLE item must be rated (OK/Fail/N-A).
//  • plain  checklist — every NON-NEGOTIABLE item must be checked, AND at least
//                       one item checked overall (no empty closures).
//  • questionnaire / caregiver_practices / no form — never gated here.
export type ChecklistGate = { canComplete: boolean; reason: string | null };

export function checklistGate(formKind: string | null, formSchema: unknown, answers: unknown): ChecklistGate {
  if (formKind !== "checklist") return { canComplete: true, reason: null };
  const schema = (formSchema ?? {}) as { scored?: boolean; items?: Array<{ key: string; nonNegotiable?: boolean }> };
  const items = schema.items ?? [];
  const a = (answers ?? {}) as { marks?: Record<string, string>; checked?: Record<string, boolean> };

  if (schema.scored === true) {
    const marks = a.marks ?? {};
    const unrated = items.filter((it) => it.nonNegotiable && !marks[it.key]).length;
    return unrated > 0
      ? { canComplete: false, reason: `${unrated} non-negotiable${unrated > 1 ? "s" : ""} to rate` }
      : { canComplete: true, reason: null };
  }

  const checked = a.checked ?? {};
  const unmet = items.filter((it) => it.nonNegotiable && !checked[it.key]).length;
  if (unmet > 0) return { canComplete: false, reason: `${unmet} non-negotiable${unmet > 1 ? "s" : ""} to check` };
  const checkedCount = items.filter((it) => checked[it.key]).length;
  if (items.length > 0 && checkedCount === 0) return { canComplete: false, reason: "Check at least one item" };
  return { canComplete: true, reason: null };
}
