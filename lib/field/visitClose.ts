// Shared close-gate for a /field cadence visit. A visit may not be signed off
// until every MANDATORY recipe step is satisfied:
//   • a scored step (24-point safety) → every NON-NEGOTIABLE item is rated
//     (OK / Fail / N-A — failing is allowed, it just raises a follow-up);
//   • any other mandatory step → it is marked Done.
// Used by both the read path (to disable the Close button) and the close route
// (authoritative enforcement). Pure — no I/O.
export type CloseStepInput = {
  title: string;
  mandatory: boolean;
  formSchema: unknown;
  done: boolean;
  answers: unknown;
};

export function computeCloseBlockers(steps: CloseStepInput[]): string[] {
  const blockers: string[] = [];
  for (const s of steps) {
    if (!s.mandatory) continue;
    const schema = s.formSchema as { scored?: boolean; items?: { key: string; nonNegotiable?: boolean }[] } | null;
    if (schema?.scored) {
      const nonNeg = (schema.items ?? []).filter((it) => it.nonNegotiable);
      const marks = ((s.answers as { marks?: Record<string, string> } | null)?.marks) ?? {};
      const unrated = nonNeg.filter((it) => !marks[it.key]).length;
      if (unrated > 0) blockers.push(`${s.title}: ${unrated} non-negotiable item${unrated > 1 ? "s" : ""} not rated`);
    } else if (!s.done) {
      blockers.push(`${s.title}: not done`);
    }
  }
  return blockers;
}
