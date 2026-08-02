// Pure aggregation over approved grant budgets for the grant portal dashboard.
// Everything here operates on already-loaded Prisma shapes so it's testable and
// reusable by server components. No DB access.
//
// Conventions (match the report export at
// app/api/budget/[id]/reports/[slotId]/export/route.ts):
//   - Grant total = Σ of active-year yN totals across all lines.
//   - Utilised     = Σ BudgetReportLine.actualAmount on reports that have been
//     submitted (slot.status ≠ pending), i.e. what the partner has reported.

import { activeYearBands } from "@/lib/budget-generator";

export const CROSS_CUTTING = "Cross-cutting";
const REPORTED_STATUSES = new Set(["submitted", "under_review", "sent_back", "approved"]);

export type LineForAgg = {
  id: string;
  domain: string | null;
  y1Total: number; y2Total: number; y3Total: number; y4Total: number; y5Total: number;
};

export type ReportSlotForAgg = {
  status: string;
  report: { lines: { budgetLineId: string; actualAmount: number }[] } | null;
};

export type BudgetForAgg = {
  id: string;
  name: string;
  city: string;
  status: string;
  horizonMonths: number;
  domains: string[];
  grantPartnerId: string | null;
  grantPartner: { id: string; name: string } | null;
  grantLeadId: string | null;
  grantLead: { id: string; name: string | null; email: string } | null;
  reportConfig: { grantStartDate: Date | string; grantEndDate: Date | string } | null;
  lines: LineForAgg[];
  reportSlots: ReportSlotForAgg[];
};

/** Σ of the active year-bands (per horizon) for one line. */
function lineTotal(l: LineForAgg, bands: number): number {
  let s = l.y1Total;
  if (bands >= 2) s += l.y2Total;
  if (bands >= 3) s += l.y3Total;
  if (bands >= 4) s += l.y4Total;
  if (bands >= 5) s += l.y5Total;
  return s;
}

export type DomainSlice = { approved: number; utilised: number };

export type GrantRow = {
  budgetId: string;
  name: string;
  city: string;
  status: string;
  domains: string[];
  partnerId: string | null;      // grantPartnerId
  partnerName: string;           // "Unassigned" when null
  grantLeadId: string | null;
  grantLeadName: string;         // "Unassigned" when null
  approved: number;
  utilised: number;
  periodFrom: string | null;     // ISO
  periodTo: string | null;
  perDomain: Record<string, DomainSlice>;
};

/** Collapse one budget into a grant row with per-domain approved + utilised. */
export function buildGrantRow(b: BudgetForAgg): GrantRow {
  const bands = activeYearBands(b.horizonMonths);
  const domainOf = new Map<string, string>();
  const perDomain: Record<string, DomainSlice> = {};
  const slice = (d: string) => (perDomain[d] ??= { approved: 0, utilised: 0 });

  for (const l of b.lines) {
    const d = l.domain ?? CROSS_CUTTING;
    domainOf.set(l.id, d);
    slice(d).approved += lineTotal(l, bands);
  }
  for (const s of b.reportSlots) {
    if (!s.report || !REPORTED_STATUSES.has(s.status)) continue;
    for (const rl of s.report.lines) {
      const d = domainOf.get(rl.budgetLineId) ?? CROSS_CUTTING;
      slice(d).utilised += rl.actualAmount;
    }
  }

  const approved = Object.values(perDomain).reduce((a, s) => a + s.approved, 0);
  const utilised = Object.values(perDomain).reduce((a, s) => a + s.utilised, 0);

  return {
    budgetId: b.id,
    name: b.name,
    city: b.city,
    status: b.status,
    domains: b.domains,
    partnerId: b.grantPartnerId,
    partnerName: b.grantPartner?.name ?? "Unassigned",
    grantLeadId: b.grantLeadId,
    grantLeadName: b.grantLead?.name ?? b.grantLead?.email ?? "Unassigned",
    approved,
    utilised,
    periodFrom: b.reportConfig ? new Date(b.reportConfig.grantStartDate).toISOString() : null,
    periodTo: b.reportConfig ? new Date(b.reportConfig.grantEndDate).toISOString() : null,
    perDomain,
  };
}

export type Rollup = {
  key: string;
  label: string;
  approved: number;
  utilised: number;
  grantCount: number;
  domains: Set<string>;
  periodFrom: string | null;
  periodTo: string | null;
  grants: GrantRow[];
};

function extendPeriod(r: Rollup, g: GrantRow) {
  if (g.periodFrom && (!r.periodFrom || g.periodFrom < r.periodFrom)) r.periodFrom = g.periodFrom;
  if (g.periodTo && (!r.periodTo || g.periodTo > r.periodTo)) r.periodTo = g.periodTo;
}

/** Group grant rows by a dimension. `by` picks the grouping key + label. */
export function rollup(
  rows: GrantRow[],
  by: (g: GrantRow) => { key: string; label: string },
): Rollup[] {
  const map = new Map<string, Rollup>();
  for (const g of rows) {
    const { key, label } = by(g);
    let r = map.get(key);
    if (!r) {
      r = { key, label, approved: 0, utilised: 0, grantCount: 0, domains: new Set(), periodFrom: null, periodTo: null, grants: [] };
      map.set(key, r);
    }
    r.approved += g.approved;
    r.utilised += g.utilised;
    r.grantCount += 1;
    g.domains.forEach((d) => r!.domains.add(d));
    r.grants.push(g);
    extendPeriod(r, g);
  }
  return [...map.values()].sort((a, b) => b.approved - a.approved);
}

export const byPartner = (g: GrantRow) => ({ key: g.partnerId ?? "unassigned", label: g.partnerName });
/** `city` holds the granting unit's name — see lib/budget/grantingUnits.ts. */
export const byGrantingUnit = (g: GrantRow) => ({ key: g.city, label: g.city });
export const byGrantLead = (g: GrantRow) => ({ key: g.grantLeadId ?? "unassigned", label: g.grantLeadName });

/** Domain rollup needs per-domain splitting (a grant spans domains), so it can't
 *  use `rollup` directly. Returns per-domain approved + utilised across grants. */
export function rollupByDomain(rows: GrantRow[]): Array<{ domain: string; approved: number; utilised: number; partners: Set<string> }> {
  const map = new Map<string, { domain: string; approved: number; utilised: number; partners: Set<string> }>();
  for (const g of rows) {
    for (const [d, s] of Object.entries(g.perDomain)) {
      let m = map.get(d);
      if (!m) { m = { domain: d, approved: 0, utilised: 0, partners: new Set() }; map.set(d, m); }
      m.approved += s.approved;
      m.utilised += s.utilised;
      m.partners.add(g.partnerName);
    }
  }
  return [...map.values()].sort((a, b) => b.approved - a.approved);
}

export function pct(utilised: number, approved: number): number | null {
  if (approved <= 0) return null;
  return Math.round((utilised / approved) * 1000) / 10;
}

// ── Cross-grant borrowing net position ──────────────────────────────────────

export type BorrowingForAgg = {
  id: string;
  fromBudgetId: string;
  toBudgetId: string;
  amount: number;
  borrowedOn: Date | string;
  repayments: { amount: number; repaidOn: Date | string }[];
};

export type BorrowingPosition = {
  borrowingId: string;
  fromBudgetId: string;
  toBudgetId: string;
  borrowed: number;    // outstanding principal as of `asOf`
  repaid: number;
  outstanding: number; // borrowed − repaid, floored at 0
};

/** Net position of every borrowing as of a date: principal recognised if
 *  borrowedOn ≤ asOf, minus repayments with repaidOn ≤ asOf. */
export function borrowingPositions(borrowings: BorrowingForAgg[], asOf: Date): BorrowingPosition[] {
  const cut = asOf.getTime();
  const out: BorrowingPosition[] = [];
  for (const b of borrowings) {
    if (new Date(b.borrowedOn).getTime() > cut) continue;
    const repaid = b.repayments
      .filter((r) => new Date(r.repaidOn).getTime() <= cut)
      .reduce((s, r) => s + r.amount, 0);
    out.push({
      borrowingId: b.id,
      fromBudgetId: b.fromBudgetId,
      toBudgetId: b.toBudgetId,
      borrowed: b.amount,
      repaid,
      outstanding: Math.max(0, b.amount - repaid),
    });
  }
  return out;
}

/** Status derived from repayment total vs principal (for display + persistence). */
export function borrowingStatus(amount: number, repaidTotal: number): "outstanding" | "partially_reimbursed" | "reimbursed" {
  if (repaidTotal <= 0) return "outstanding";
  if (repaidTotal >= amount) return "reimbursed";
  return "partially_reimbursed";
}
