"use client";

// Line-array state plus the four line mutations, shared by the internal manage
// view and the grantee's draft view. Both hold the same rows against the same
// server actions; the server decides whether the caller may write them.

import { useState, useTransition } from "react";
import type { BudgetSection } from "@/app/generated/prisma/client";
import { addLine, deleteLine, saveBudgetLineComponents, updateLine } from "../../actions";
import type { NewLineInput } from "./BudgetLineTable";
import type { Line, LineWorking, WorkingComp } from "./types";

export function useBudgetLines(budgetId: string, initialLines: Line[], initialWorking: Record<string, LineWorking>) {
  const [lines, setLines] = useState<Line[]>(initialLines);
  const [working, setWorking] = useState<Record<string, LineWorking>>(initialWorking);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /** Server rejections here are mostly the stale-line compare-and-swap, which the
   *  optimistic row above has already hidden. Surface it rather than swallow it. */
  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      try { await fn(); setError(null); }
      catch (e) { setError(e instanceof Error ? e.message : "That didn't save. Reload and try again."); }
    });

  const saveLine = (lineId: string, vals: Partial<Line>) => {
    const line = lines.find(l => l.id === lineId);
    const tot = (u?: number, c?: number, a?: number) => Math.round((u ?? 0) * (c ?? 0) * (a ?? 1));
    const totals: Partial<Line> = {
      y1Total: tot(vals.y1Units, vals.y1UnitCost, vals.y1AllocPct),
      y2Total: tot(vals.y2Units, vals.y2UnitCost, vals.y2AllocPct),
      y3Total: tot(vals.y3Units, vals.y3UnitCost, vals.y3AllocPct),
      y4Total: tot(vals.y4Units, vals.y4UnitCost, vals.y4AllocPct),
      y5Total: tot(vals.y5Units, vals.y5UnitCost, vals.y5AllocPct),
    };
    setLines(prev => prev.map(l => l.id === lineId ? { ...l, ...vals, ...totals } : l));
    run(async () => {
      const { updatedAt } = await updateLine(lineId, vals, line?.updatedAt);
      setLines(prev => prev.map(l => l.id === lineId ? { ...l, updatedAt } : l));
    });
  };

  const removeLine = (lineId: string) => {
    setLines(prev => prev.filter(l => l.id !== lineId));
    run(() => deleteLine(lineId));
  };

  const appendLine = (section: BudgetSection, input: NewLineInput, deliveryPartnerId: string | null) => {
    run(async () => {
      const line = await addLine(budgetId, { section, deliveryPartnerId, ...input });
      // The action returns the Prisma row, whose updatedAt is a Date; the rest of
      // the editor carries it as the ISO string the page serialised.
      setLines(prev => [...prev, { ...line, updatedAt: line.updatedAt.toISOString() } as unknown as Line]);
    });
  };

  const saveWorking = (line: Line, components: WorkingComp[], derivation: string | null) => {
    const rollup = Math.round(components.reduce((s, r) => s + r.qty * r.unitCost, 0));
    run(async () => {
      const { updatedAt } = await saveBudgetLineComponents(line.id, components, derivation, line.updatedAt);
      // Reflect the new base cost + ratio-scaled out-years, matching what the
      // server action does.
      const ratio = line.y1UnitCost > 0 && components.length > 0 ? rollup / line.y1UnitCost : 1;
      setLines(prev => prev.map(l => {
        if (l.id !== line.id) return l;
        if (components.length === 0) return { ...l, updatedAt };
        const sc = (c: number) => (l.y1UnitCost > 0 ? Math.round(c * ratio) : rollup);
        const y1 = rollup, y2 = sc(l.y2UnitCost), y3 = sc(l.y3UnitCost), y4 = sc(l.y4UnitCost), y5 = sc(l.y5UnitCost);
        const t = (u: number, c: number, a: number) => Math.round(u * c * a);
        return { ...l, updatedAt, y1UnitCost: y1, y1Total: t(l.y1Units, y1, l.y1AllocPct), y2UnitCost: y2, y2Total: t(l.y2Units, y2, l.y2AllocPct), y3UnitCost: y3, y3Total: t(l.y3Units, y3, l.y3AllocPct), y4UnitCost: y4, y4Total: t(l.y4Units, y4, l.y4AllocPct), y5UnitCost: y5, y5Total: t(l.y5Units, y5, l.y5AllocPct) };
      }));
      setWorking(p => ({ ...p, [line.id]: { components, derivation, customised: true, frozen: true } }));
    });
  };

  return { lines, working, pending, error, dismissError: () => setError(null), saveLine, removeLine, appendLine, saveWorking };
}
