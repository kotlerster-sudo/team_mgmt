/**
 * Deterministic Finance Annexure derivation.
 *
 * Given partner_data + DD + judgement + assembly, projects the finance
 * annexure. No LLM, no free text — every field is either copied, tagged,
 * summed, or ratio'd from structured inputs.
 *
 * The one RP-owned field on this step is `accounting_rating`, captured
 * via the Finance UI form and passed in as `rpInput`.
 */

import type { AssemblyRow } from '../repo';
import type { PartnerData, Judgement, FinanceAnnexure } from '../schema';
import type { RuleResult } from '../validation/types';

const FY_LABELS = ['FY22-23', 'FY23-24', 'FY24-25', 'FY25-26', 'FY26-27', 'FY27-28', 'FY28-29'] as const;

/** Domestic vs International heuristic based on FunderType. */
function originForType(t: string): 'domestic' | 'international' {
  return t === 'fcra_international' ? 'international' : 'domestic';
}

/** FY buckets that count as "prior 2 years" — the 2 most recent completed. */
function priorTwoFys(now: Date): [string, string] {
  const y = now.getFullYear();
  const currentFy = now.getMonth() >= 3 ? y : y - 1; // April cutoff
  const prior1 = `FY${String(currentFy - 1).slice(-2)}-${String(currentFy).slice(-2)}`;
  const prior2 = `FY${String(currentFy - 2).slice(-2)}-${String(currentFy - 1).slice(-2)}`;
  return [prior1, prior2];
}

/** Sum a per-FY map. */
function sumFy(m: Record<string, number>): number {
  return Object.values(m).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
}

/* ── main derivation ── */

export type FinanceRpInput = {
  accounting: {
    system: 'manual' | 'tally' | 'erp';
    monthly_close: boolean;
    audit_report_url: string | null;
  };
  grant_summary: {
    grant_number: number;
    value_inr: number;
    duration_months: number;
  };
};

export type DerivedFinance = FinanceAnnexure & {
  computed_dependency_pct: number;
  computed_avg_last_3fy: number;
};

export function deriveFinance(input: {
  assembly: AssemblyRow;
  partner: PartnerData;
  dd: Record<string, unknown> | null;
  judgement: Judgement | null;
  validation: { results: RuleResult[]; acknowledgments: Record<string, { note?: string }> } | null;
  rpInput: FinanceRpInput | null;
}): DerivedFinance {
  const { partner, dd, judgement, validation, rpInput, assembly } = input;

  /* Donor diversity — one row per funder, current + prior-2y sums. */
  const [prior1, prior2] = priorTwoFys(new Date());
  const donor_diversity = partner.funding.donors.map((d) => {
    const amounts = d.amounts_by_fy;
    return {
      funder_name: d.funder_name,
      funder_type: d.funder_type,
      origin: originForType(d.funder_type),
      amount_current: amounts[prior1] || 0,
      amount_prior_2y: (amounts[prior1] || 0) + (amounts[prior2] || 0),
    };
  });

  /* Statutory summary — from DD compliance_check + statutory_filings. */
  const compliance = (dd?.compliance_check as any) || {};
  const statutoryFilings = (dd?.statutory_filings as any) || {};

  const reg12aRow = compliance.mandatory?.['12a-80g'];
  const has12a80g = Array.isArray(reg12aRow?.responses)
    ? reg12aRow.responses.some((r: string) => r === 'yes')
    : false;

  const fcraRow = compliance.mandatory?.fcra;
  const fcraDocValid = (fcraRow?.documents || []).find(
    (d: any) => d?.validation?.status === 'pass',
  );
  // Try to extract FCRA "valid until" from the doc validation summary; else null.
  const fcraValidUntil = fcraDocValid?.validation?.details?.valid_until || null;

  const itr = statutoryFilings.annualReturns?.itr;
  const statutory = {
    fcra_valid_until: fcraValidUntil,
    reg_12a_present: has12a80g,
    reg_12a_date: null as string | null,
    reg_80g_present: has12a80g,
    reg_80g_date: null as string | null,
    latest_itr_fy: itr?.fy || null,
    latest_itr_filing_date: itr?.filingDate || null,
    pending_demands: null as string | null,
  };

  /* Accounting rating — from RP input; if absent, provisional 'basic'. */
  const accInput = rpInput?.accounting;
  const accountingScore: 'nascent' | 'basic' | 'adequate' =
    !accInput
      ? 'basic'
      : accInput.system === 'erp' && accInput.monthly_close && accInput.audit_report_url
        ? 'adequate'
        : accInput.system === 'tally' && accInput.monthly_close
          ? 'basic'
          : 'nascent';

  const accounting = {
    system: accInput?.system ?? 'manual',
    monthly_close: accInput?.monthly_close ?? false,
    audit_report_url: accInput?.audit_report_url ?? null,
    score: accountingScore,
  };

  /* Average annual spend — from partner.expenditure.overall. */
  const overall: Record<string, number> = {};
  for (const row of partner.expenditure.overall) {
    for (const [fy, v] of Object.entries(row.amounts_by_fy || {})) {
      overall[fy] = (overall[fy] || 0) + (typeof v === 'number' ? v : 0);
    }
  }
  const foundation: Record<string, number> = {};
  for (const row of partner.expenditure.foundation_supported) {
    for (const [fy, v] of Object.entries(row.amounts_by_fy || {})) {
      foundation[fy] = (foundation[fy] || 0) + (typeof v === 'number' ? v : 0);
    }
  }
  const last3 = FY_LABELS.slice(0, 3).map((fy) => overall[fy] || 0);
  const avg3fy = last3.reduce((a, b) => a + b, 0) / (last3.filter((n) => n > 0).length || 1);

  /* Grant summary — dependency % = this-grant-annual / avg-annual-spend. */
  const grantYearly = rpInput?.grant_summary
    ? rpInput.grant_summary.value_inr / Math.max(1, rpInput.grant_summary.duration_months / 12)
    : 0;
  const dependencyPct = avg3fy > 0 ? Math.round((grantYearly / avg3fy) * 100) : 0;

  const grant_summary = {
    grant_number: rpInput?.grant_summary?.grant_number ?? 1,
    value_inr: rpInput?.grant_summary?.value_inr ?? 0,
    duration_months: rpInput?.grant_summary?.duration_months ?? 12,
    dependency_pct: dependencyPct,
    // Real budget split lands in Phase 3b when a Budget is linked. Empty
    // placeholder for now so the shape validates.
    budget_split_pct: {
      program_salaries: 0,
      program: 0,
      travel: 0,
      fixed_assets: 0,
      admin_salaries: 0,
      admin_other: 0,
    },
  };

  /* Action points — merge validation acks with judgement conditions. */
  const action_points: FinanceAnnexure['action_points'] = [];
  if (validation) {
    for (const rr of validation.results) {
      if ((rr.status === 'warn' || rr.status === 'fail') && validation.acknowledgments[rr.rule_id]) {
        action_points.push({
          source: 'validation_ack',
          title: rr.label,
          detail: validation.acknowledgments[rr.rule_id].note || rr.message,
        });
      }
    }
  }
  if (judgement?.conditions) {
    for (const c of judgement.conditions) {
      action_points.push({
        source: 'condition',
        title: c.title,
        detail: c.description,
      });
    }
  }

  const spend = {
    by_fy_overall: overall,
    by_fy_foundation_share: foundation,
    average_last_3fy: Math.round(avg3fy),
  };

  return {
    donor_diversity,
    statutory,
    accounting,
    spend,
    grant_summary,
    action_points,
    computed_dependency_pct: dependencyPct,
    computed_avg_last_3fy: Math.round(avg3fy),
  };
}
