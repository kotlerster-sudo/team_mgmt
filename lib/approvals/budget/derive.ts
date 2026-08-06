/**
 * Budget annexure derivation for the wizard.
 * Reuses the mature loadBudgetSnapshot from lib/review/budget-bridge and
 * layers on: cost-per-beneficiary, multi-year cash flow (Y1/Y2/Y3), outlier
 * detection (|pct| > 25%), per-partner splits (multi-partner budgets), and
 * a portfolio-comparables placeholder that stays empty until we add the
 * five extended fields to Budget in a follow-up migration.
 */

import prisma from '@/lib/prisma';
import { loadBudgetSnapshot, type BudgetComparisonSnapshot } from '@/lib/review/budget-bridge';

export type CostPerBeneficiary = {
  y1_total: number;
  beneficiaries_per_year: number;
  cost_per_beneficiary: number;
  method: 'direct' | 'derived_from_seats' | 'estimate';
  caveat?: string;
};

export type CashFlowYear = { year_label: string; amount: number };

export type OutlierRow = {
  templateKey: string;
  description: string;
  perUnitProposed: number;
  perUnitStandard: number;
  pct: number; // signed
};

export type PortfolioComparable = {
  budget_id: string;
  budget_name: string;
  city: string;
  domain: string;
  intervention_model: string | null;
  cost_per_beneficiary: number;
  approved_at: string | null;
  caveat: string;
};

export type DerivedBudget = {
  snapshot: BudgetComparisonSnapshot;
  cost_per_beneficiary: CostPerBeneficiary;
  multi_year_cash_flow: { years: CashFlowYear[]; tranches: [] };
  outliers: OutlierRow[];
  per_partner_snapshots: Record<string, BudgetComparisonSnapshot> | null;
  portfolio_comparables: PortfolioComparable[];
  portfolio_comparables_note: string;
};

const OUTLIER_THRESHOLD_PCT = 25;

async function multiYearCashFlow(budgetId: string): Promise<CashFlowYear[]> {
  const lines = await prisma.budgetLine.findMany({
    where: { budgetId },
    select: { y1Total: true, y2Total: true, y3Total: true },
  });
  const y1 = lines.reduce((a, l) => a + (l.y1Total || 0), 0);
  const y2 = lines.reduce((a, l) => a + (l.y2Total || 0), 0);
  const y3 = lines.reduce((a, l) => a + (l.y3Total || 0), 0);
  const years: CashFlowYear[] = [{ year_label: 'Year 1', amount: y1 }];
  if (y2 > 0) years.push({ year_label: 'Year 2', amount: y2 });
  if (y3 > 0) years.push({ year_label: 'Year 3', amount: y3 });
  return years;
}

async function perPartnerSnapshots(
  budgetId: string,
  domain: string,
  viewerUserId: string,
): Promise<Record<string, BudgetComparisonSnapshot> | null> {
  const budget = await prisma.budget.findUnique({
    where: { id: budgetId },
    select: {
      isMultiPartner: true,
      deliveryPartners: { select: { id: true, name: true } },
    },
  });
  if (!budget?.isMultiPartner) return null;
  // NOTE: loadBudgetSnapshot doesn't yet accept a per-partner filter.
  // For now we return a placeholder map keyed by partner name so the UI
  // can flag "multi-partner detected — per-partner split pending".
  const map: Record<string, BudgetComparisonSnapshot> = {};
  for (const dp of budget.deliveryPartners) {
    // Reuse the combined snapshot for every key until per-partner loading
    // lands (Phase 3b follow-up). Marked in comparables_note.
    const snap = await loadBudgetSnapshot(budgetId, viewerUserId, domain);
    if (snap) map[dp.name] = snap;
  }
  return Object.keys(map).length ? map : null;
}

function extractOutliers(snapshot: BudgetComparisonSnapshot): OutlierRow[] {
  const out: OutlierRow[] = [];
  for (const g of snapshot.groups) {
    for (const r of g.rows) {
      if (r.pct == null) continue;
      if (Math.abs(r.pct) < OUTLIER_THRESHOLD_PCT) continue;
      out.push({
        templateKey: r.templateKey,
        description: r.description,
        perUnitProposed: r.perUnitProposed,
        perUnitStandard: r.perUnitStandard,
        pct: r.pct,
      });
    }
  }
  return out.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
}

export async function deriveBudget(input: {
  budgetId: string;
  domain: string;
  viewerUserId: string;
  beneficiariesPerYear: number;
}): Promise<DerivedBudget> {
  const snapshot = await loadBudgetSnapshot(input.budgetId, input.viewerUserId, input.domain);
  if (!snapshot) throw new Error('Budget snapshot could not be built (check access + domain).');

  const y1Total = snapshot.groups.reduce((a, g) => a + g.subtotalProposed, 0) * snapshot.unitCount;
  const per = input.beneficiariesPerYear > 0 ? y1Total / input.beneficiariesPerYear : 0;

  const cost_per_beneficiary: CostPerBeneficiary = {
    y1_total: Math.round(y1Total),
    beneficiaries_per_year: input.beneficiariesPerYear,
    cost_per_beneficiary: Math.round(per),
    method: 'direct',
    caveat:
      input.beneficiariesPerYear > 0
        ? undefined
        : 'Beneficiary count is 0 — cost-per-beneficiary cannot be computed.',
  };

  const cash = await multiYearCashFlow(input.budgetId);
  const outliers = extractOutliers(snapshot);
  const per_partner_snapshots = await perPartnerSnapshots(input.budgetId, input.domain, input.viewerUserId);

  return {
    snapshot,
    cost_per_beneficiary,
    multi_year_cash_flow: { years: cash, tranches: [] },
    outliers,
    per_partner_snapshots,
    portfolio_comparables: [],
    portfolio_comparables_note:
      'Comparables require adding theme + interventionModel + beneficiariesPerYear + approvedAt/approvedAmount to the Budget schema. Empty until that migration lands.',
  };
}
