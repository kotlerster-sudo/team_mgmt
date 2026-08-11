// Generic DAG auto-layout, lifted verbatim from programmes/[id]/PhaseCanvas.tsx.
// Assigns each node a column = its longest path from any root, and stacks siblings
// vertically within a column. Pure — operates on ids + edges + an optional label for
// stable sibling ordering. Reused by the control-plane graph and the programme phase canvas.

export type LayoutNode = { id: string; label?: string };
export type LayoutEdge = { from: string; to: string };

export type LayoutOpts = {
  colW?: number;
  rowH?: number;
  padding?: number;
};

export function autoLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  opts: LayoutOpts = {},
): Map<string, { x: number; y: number }> {
  const COL_W = opts.colW ?? 240;
  const ROW_H = opts.rowH ?? 110;
  const PADDING = opts.padding ?? 24;

  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    (incoming.get(e.to) ?? incoming.set(e.to, []).get(e.to)!).push(e.from);
  }

  // Column = longest distance from any root (no incoming edges).
  const column = new Map<string, number>();
  const visit = (id: string, depth: number, seen: Set<string>): number => {
    if (seen.has(id)) return depth; // break cycles
    seen.add(id);
    const ins = incoming.get(id) ?? [];
    if (ins.length === 0) {
      column.set(id, Math.max(column.get(id) ?? 0, depth));
      return depth;
    }
    let max = 0;
    for (const p of ins) max = Math.max(max, visit(p, depth + 1, new Set(seen)));
    column.set(id, Math.max(column.get(id) ?? 0, max));
    return max;
  };
  for (const n of nodes) visit(n.id, 0, new Set());

  // Actual column = maxDepth - column[id] (roots at column 0).
  const maxCol = Math.max(0, ...Array.from(column.values()));
  const colOf = (id: string) => maxCol - (column.get(id) ?? 0);

  const labelOf = new Map(nodes.map((n) => [n.id, n.label ?? ""]));
  const byCol = new Map<number, string[]>();
  for (const n of nodes) {
    const c = colOf(n.id);
    (byCol.get(c) ?? byCol.set(c, []).get(c)!).push(n.id);
  }

  const layout = new Map<string, { x: number; y: number }>();
  for (const [c, ids] of byCol) {
    ids.sort((a, b) => (labelOf.get(a) ?? "").localeCompare(labelOf.get(b) ?? ""));
    ids.forEach((id, i) => {
      layout.set(id, { x: PADDING + c * COL_W, y: PADDING + i * ROW_H });
    });
  }
  return layout;
}
