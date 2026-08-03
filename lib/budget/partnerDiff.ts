// What the grantee changed on a shared draft. Compares the budget's lines as
// they stand now against Budget.partnerBaseline — the snapshot taken when the
// lead shared it. Pure, so the review UI and any future notification copy
// derive from the same arithmetic.

export type BaselineLine = {
  id: string;
  description: string;
  section: string;
  domain: string | null;
  unitType: string;
  y1Units: number;
  y1UnitCost: number;
  y1Total: number;
  derivation: string | null;
  /** Component rollup, so a rewritten working shows even at an unchanged cost. */
  workingSignature: string;
};

export type FieldChange = { field: keyof BaselineLine; before: unknown; after: unknown };

export type LineDiff = {
  added: BaselineLine[];
  removed: BaselineLine[];
  changed: { before: BaselineLine; after: BaselineLine; fields: FieldChange[] }[];
  /** Year-1 total across all current lines, minus the same across the baseline. */
  y1Delta: number;
};

const COMPARED: (keyof BaselineLine)[] = [
  "description", "section", "domain", "unitType",
  "y1Units", "y1UnitCost", "y1Total", "derivation", "workingSignature",
];

/** Stable text for a line's component breakup, so a reworked working is visible
 *  even when the rollup lands on the same unit cost. */
export function workingSignature(
  components: { label: string; spec: string | null; qty: number; unitCost: number }[],
): string {
  return components.map(c => `${c.label}|${c.spec ?? ""}|${c.qty}|${c.unitCost}`).join("\n");
}

export function diffAgainstBaseline(baseline: BaselineLine[], current: BaselineLine[]): LineDiff {
  const byId = new Map(baseline.map(l => [l.id, l]));
  const seen = new Set<string>();

  const added: BaselineLine[] = [];
  const changed: LineDiff["changed"] = [];

  for (const after of current) {
    const before = byId.get(after.id);
    if (!before) { added.push(after); continue; }
    seen.add(after.id);
    const fields = COMPARED
      .filter(f => !same(before[f], after[f]))
      .map(f => ({ field: f, before: before[f], after: after[f] }));
    if (fields.length > 0) changed.push({ before, after, fields });
  }

  const removed = baseline.filter(l => !seen.has(l.id));
  const sum = (rows: BaselineLine[]) => rows.reduce((s, l) => s + l.y1Total, 0);

  return { added, removed, changed, y1Delta: Math.round(sum(current) - sum(baseline)) };
}

// Money and quantities arrive as Floats; round to the rupee (and to 4 decimals
// for fractional units) so a float artefact doesn't read as a partner edit.
function same(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") {
    return Math.round(a * 10000) === Math.round(b * 10000);
  }
  return (a ?? null) === (b ?? null);
}
