/**
 * Critical path over a centre's setup-pitstop dependency graph (a DAG built from PitstopDependency).
 *
 * Edge semantics: `blockedBy` lists a node's PREDECESSORS — they must finish before it can start
 * (finish-to-start). The critical path is the longest dependency chain (by node count) ending at the
 * milestone gate (or, if none, the node with the longest chain). "front" is the current chase target:
 * the earliest incomplete node on that path whose predecessors are all done.
 *
 * Pure + cycle-safe (a back-edge contributes 0), so it can be unit-reasoned and reused by any loader.
 */

export type CpNode = {
  id: string;
  blockedBy: string[]; // predecessor node ids
  done: boolean;
};

export type CriticalPathResult = {
  /** Node ids on the critical path. */
  path: Set<string>;
  /** "This week" chase target: earliest incomplete node on the path whose predecessors are all done. */
  frontId: string | null;
};

export function computeCriticalPath(nodes: CpNode[], milestoneIds: string[] = []): CriticalPathResult {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const memo = new Map<string, number>();
  const inProgress = new Set<string>();

  // Longest dependency chain ending AT id (inclusive), in node count.
  const chainLen = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (inProgress.has(id)) return 0; // cycle guard
    const n = byId.get(id);
    if (!n) return 0;
    inProgress.add(id);
    let best = 0;
    for (const p of n.blockedBy) best = Math.max(best, chainLen(p));
    inProgress.delete(id);
    const len = best + 1;
    memo.set(id, len);
    return len;
  };

  // Terminal node: a milestone with the longest chain, else the longest chain overall.
  const candidates = milestoneIds.filter((id) => byId.has(id));
  const pool = candidates.length ? candidates : nodes.map((n) => n.id);
  let end: string | null = null;
  let endLen = -1;
  for (const id of pool) {
    const l = chainLen(id);
    if (l > endLen) { endLen = l; end = id; }
  }

  // Backtrack from the terminal, always following the predecessor with the longest chain.
  const path = new Set<string>();
  let cur = end;
  const guard = new Set<string>();
  while (cur && !guard.has(cur)) {
    guard.add(cur);
    path.add(cur);
    const n = byId.get(cur);
    if (!n || n.blockedBy.length === 0) break;
    let next: string | null = null;
    let nextLen = -1;
    for (const p of n.blockedBy) {
      const l = chainLen(p);
      if (l > nextLen) { nextLen = l; next = p; }
    }
    cur = next;
  }

  // Front = earliest-on-path node (shortest chain first) that's incomplete with all predecessors done.
  const ordered = [...path].sort((a, b) => chainLen(a) - chainLen(b));
  let frontId: string | null = null;
  for (const id of ordered) {
    const n = byId.get(id)!;
    if (n.done) continue;
    if (n.blockedBy.every((p) => byId.get(p)?.done ?? true)) { frontId = id; break; }
  }
  if (!frontId) frontId = ordered.find((id) => !byId.get(id)!.done) ?? null;

  return { path, frontId };
}
