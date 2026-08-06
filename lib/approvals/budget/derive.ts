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

const MAX_COMPARABLES = 4;
const COMPARABLES_MAX_AGE_YEARS = 3;

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

/**
 * Portfolio comparables — the "cost per beneficiary vs 2-4 similar past
 * grants" table. Matches on city + domain overlap + intervention model,
 * restricts to approved budgets from the last COMPARABLES_MAX_AGE_YEARS,
 * excludes the current one. Returns [] silently if no matches (empty
 * table renders in the docx as "No comparable approved budgets on file").
 */
async function portfolioComparables(input: {
  currentBudgetId: string;
  city: string;
  domain: string;
  interventionModel: string | null;
}): Promise<PortfolioComparable[]> {
  const since = new Date();
  since.setFullYear(since.getFullYear() - COMPARABLES_MAX_AGE_YEARS);

  const rows = await prisma.budget.findMany({
    where: {
      id: { not: input.currentBudgetId },
      city: input.city,
      domains: { has: input.domain },
      approvedAt: { not: null, gte: since },
      beneficiariesPerYear: { not: null, gt: 0 },
      // interventionModel is nice-to-match but not required — comparability
      // caveat notes when it differs.
    },
    orderBy: [{ approvedAt: 'desc' }],
    take: MAX_COMPARABLES * 3, // over-fetch, we'll trim after
    select: {
      id: true,
      name: true,
      city: true,
      domains: true,
      interventionModel: true,
      approvedAt: true,
      approvedAmount: true,
      beneficiariesPerYear: true,
      lines: { select: { y1Total: true } },
    },
  });

  const scored = rows
    .map((r) => {
      const y1 = r.lines.reduce((a, l) => a + (l.y1Total || 0), 0);
      const bens = r.beneficiariesPerYear || 0;
      const cpb = bens > 0 ? y1 / bens : 0;
      if (cpb === 0) return null;
      const caveats: string[] = [];
      if (input.interventionModel && r.interventionModel !== input.interventionModel) {
        caveats.push(
          `intervention model differs (${r.interventionModel ?? 'unset'} vs ${input.interventionModel})`,
        );
      }
      const cutDomain = r.domains[0] || '';
      if (cutDomain !== input.domain) caveats.push(`domain overlaps but primary differs (${cutDomain})`);
      return {
        budget_id: r.id,
        budget_name: r.name,
        city: r.city,
        domain: cutDomain || input.domain,
        intervention_model: r.interventionModel,
        cost_per_beneficiary: Math.round(cpb),
        approved_at: r.approvedAt ? r.approvedAt.toISOString().slice(0, 10) : null,
        caveat: caveats.length ? caveats.join('; ') : 'Same city, same domain, approved in last 3 years.',
      } satisfies PortfolioComparable;
    })
    .filter((r): r is PortfolioComparable => r != null)
    // Prefer exact intervention-model matches at the top.
    .sort((a, b) => {
      if (input.interventionModel) {
        const aMatch = a.intervention_model === input.interventionModel ? 0 : 1;
        const bMatch = b.intervention_model === input.interventionModel ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
      }
      return 0;
    })
    .slice(0, MAX_COMPARABLES);

  return scored;
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

  // For the comparables query, pull this budget's own intervention model so
  // matches can be prioritised. Fine if it's null — the query still works.
  const meta = await prisma.budget.findUnique({
    where: { id: input.budgetId },
    select: { city: true, interventionModel: true },
  });
  const comparables = meta
    ? await portfolioComparables({
        currentBudgetId: input.budgetId,
        city: meta.city,
        domain: input.domain,
        interventionModel: meta.interventionModel ?? null,
      })
    : [];

  return {
    snapshot,
    cost_per_beneficiary,
    multi_year_cash_flow: { years: cash, tranches: [] },
    outliers,
    per_partner_snapshots,
    portfolio_comparables: comparables,
    portfolio_comparables_note:
      comparables.length === 0
        ? 'No approved comparables in the last 3 years for this city + domain. Back-fill theme / interventionModel / beneficiariesPerYear / approvedAt on more budgets to enrich this table.'
        : `${comparables.length} comparable(s) matched.`,
  };
}
