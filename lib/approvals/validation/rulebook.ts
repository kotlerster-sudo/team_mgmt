/**
 * Deterministic validation rules for approval assemblies.
 *
 * Design:
 *  - Every rule is a pure function of RuleContext. No I/O.
 *  - Zod already enforces per-field validity at Step 1 submit; the rules
 *    here look at cross-cutting conditions Zod can't express: math
 *    consistency, statutory freshness, governance sanity, doc-type gating.
 *  - Rules never throw. Missing input yields status 'na' with a clear
 *    message so the RP sees why a rule couldn't run.
 *  - Warn = acknowledge to proceed. Fail = also acknowledge to proceed
 *    (bug or intentional — RP owns the call, but every fail is audited).
 */

import type { Rule } from './types';
import { FY_LABELS } from '../../../app/partner/approvals/[id]/_shared';

/* ─────────────── helpers (kept private) ─────────────── */

const sumByFy = (rows: Array<{ amounts_by_fy: Record<string, number> }>) => {
  const totals: Record<string, number> = {};
  for (const r of rows) {
    for (const [fy, v] of Object.entries(r.amounts_by_fy || {})) {
      totals[fy] = (totals[fy] || 0) + (typeof v === 'number' ? v : 0);
    }
  }
  return totals;
};

const daysSince = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
};

const parseIsoDate = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const [, d, mm, y] = m;
    return `${y}-${mm.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
};

/* ─────────────── the rulebook ─────────────── */

export const RULES: Rule[] = [
  /* ── Math ── */
  ...FY_LABELS.slice(0, 4).map<Rule>((fy) => ({
    id: `math.funding_vs_expenditure.${fy}`,
    label: `Funding total ≈ Expenditure total for ${fy}`,
    category: 'math',
    check: ({ partner }) => {
      const fundingTotals = sumByFy(partner.funding.donors as never);
      const expTotals = sumByFy(partner.expenditure.overall as never);
      const f = fundingTotals[fy] || 0;
      const e = expTotals[fy] || 0;
      if (f === 0 && e === 0) {
        return { status: 'na', message: `No data reported for ${fy}.` };
      }
      if (e === 0) {
        return { status: 'warn', message: `Funding of ₹${f.toLocaleString('en-IN')} but no expenditure reported.` };
      }
      const drift = Math.abs(f - e) / e;
      const pct = Math.round(drift * 100);
      const details = { funding: f, expenditure: e, drift_pct: pct };
      if (drift <= 0.15) return { status: 'pass', message: `Drift ${pct}% is within 15%.`, details };
      if (drift <= 0.3) return { status: 'warn', message: `Drift ${pct}% exceeds 15%.`, details };
      return { status: 'fail', message: `Drift ${pct}% exceeds 30% — figures don't reconcile.`, details };
    },
  })),

  {
    id: 'math.foundation_leq_overall',
    label: 'Foundation-supported spend ≤ overall spend per FY',
    category: 'math',
    check: ({ partner }) => {
      const overall = sumByFy(partner.expenditure.overall as never);
      const foundation = sumByFy(partner.expenditure.foundation_supported as never);
      const offenders: Array<{ fy: string; overall: number; foundation: number }> = [];
      for (const fy of Object.keys(foundation)) {
        if ((foundation[fy] || 0) > (overall[fy] || 0)) {
          offenders.push({ fy, overall: overall[fy] || 0, foundation: foundation[fy] || 0 });
        }
      }
      if (offenders.length === 0) {
        return { status: 'pass', message: 'Foundation-supported never exceeds overall.' };
      }
      return {
        status: 'fail',
        message: `Foundation-supported > overall in ${offenders.length} FY(s).`,
        details: { offenders },
      };
    },
  },

  {
    id: 'math.current_fy_dated',
    label: 'Current-FY expenditure has an as-of date',
    category: 'math',
    check: ({ partner }) => {
      const withCurrent = (partner.expenditure.overall || []).filter(
        (r) => typeof r.current_fy_amount === 'number' && r.current_fy_amount > 0,
      );
      if (withCurrent.length === 0) return { status: 'na', message: 'No current-FY spend reported.' };
      const undated = withCurrent.filter((r) => !r.current_fy_as_of);
      if (undated.length === 0) return { status: 'pass', message: 'All current-FY rows are dated.' };
      return {
        status: 'warn',
        message: `${undated.length} current-FY row(s) missing as-of date.`,
        details: { undated_categories: undated.map((r) => r.category) },
      };
    },
  },

  {
    id: 'math.beneficiary_per_year_positive',
    label: 'Beneficiary count per year is > 0',
    category: 'beneficiary',
    check: ({ partner }) => {
      const n = partner.beneficiary_targets.per_year;
      if (n > 0) return { status: 'pass', message: `${n.toLocaleString('en-IN')} beneficiaries/year.` };
      return { status: 'fail', message: 'Beneficiary count is required for cost-per-beneficiary math.' };
    },
  },

  /* ── Governance ── */
  {
    id: 'governance.has_president_and_secretary',
    label: 'Board has both a president and a secretary',
    category: 'governance',
    check: ({ partner }) => {
      const roles = new Set(partner.governing_body.map((m) => m.role));
      const hasPresident = roles.has('president') || roles.has('patron');
      const hasSecretary = roles.has('secretary') || roles.has('joint_secretary');
      if (hasPresident && hasSecretary) return { status: 'pass', message: 'Both offices filled.' };
      const missing = [!hasPresident && 'president', !hasSecretary && 'secretary'].filter(Boolean);
      return { status: 'warn', message: `Missing: ${missing.join(', ')}.` };
    },
  },

  {
    id: 'governance.tenure_reasonable',
    label: 'Board tenures ≤ 30 years',
    category: 'governance',
    check: ({ partner }) => {
      const outliers = partner.governing_body.filter((m) => m.tenure_board_years > 30);
      if (outliers.length === 0) return { status: 'pass', message: 'All tenures under 30 years.' };
      return {
        status: 'warn',
        message: `${outliers.length} member(s) with > 30-year tenure — verify.`,
        details: { members: outliers.map((m) => m.name) },
      };
    },
  },

  {
    id: 'governance.political_exposure_flagged',
    label: 'Members with current political exposure surfaced',
    category: 'governance',
    check: ({ partner }) => {
      const flagged = partner.governing_body.filter((m) => m.political_exposure === 'current');
      if (flagged.length === 0) return { status: 'pass', message: 'None declared.' };
      return {
        status: 'warn',
        message: `${flagged.length} member(s) with current political exposure — confirm mitigations.`,
        details: { members: flagged.map((m) => m.name) },
      };
    },
  },

  /* ── Beneficiary (partial without budget; Phase 3 completes) ── */
  {
    id: 'beneficiary.effects_and_outcomes_typed',
    label: 'Effect beneficiary types match measurable outcomes',
    category: 'beneficiary',
    check: ({ partner }) => {
      const effectTypes = new Set(partner.pdd.effects.map((e) => e.beneficiary_type));
      const outcomeTypes = new Set(
        (partner.pdd.goal.measurable_outcomes || []).map((o) => o.beneficiary_type),
      );
      // Warn if there's zero overlap AND both are non-empty
      if (effectTypes.size === 0 || outcomeTypes.size === 0) {
        return { status: 'na', message: 'Not enough data to compare.' };
      }
      const intersection = [...effectTypes].filter((x) => outcomeTypes.has(x));
      if (intersection.length > 0) return { status: 'pass', message: 'Types overlap.' };
      return {
        status: 'warn',
        message: 'No overlap between effect types and outcome types — verify the theory of change.',
        details: { effect_types: [...effectTypes], outcome_types: [...outcomeTypes] },
      };
    },
  },

  /* ── Renewal-only ── */
  {
    id: 'renewal.prior_grants_reported',
    label: 'Prior grant history is filled (renewals)',
    category: 'renewal',
    check: ({ assembly, partner }) => {
      if (assembly.doc_type !== 'standard_renewal') {
        return { status: 'na', message: 'Not a renewal.' };
      }
      if ((partner.pdd.history_with_foundation || []).length > 0) {
        return { status: 'pass', message: `${partner.pdd.history_with_foundation.length} prior grant(s) recorded.` };
      }
      return { status: 'fail', message: 'Renewal must list at least one prior grant.' };
    },
  },

  /* ── Statutory (from DD) ── */
  {
    id: 'statutory.dd_present',
    label: 'Due-diligence record exists',
    category: 'coverage',
    check: ({ dd }) => {
      if (dd) return { status: 'pass', message: 'DD row found.' };
      return {
        status: 'warn',
        message: 'No due-diligence record for this org — statutory checks skipped.',
      };
    },
  },

  {
    id: 'statutory.fcra_valid',
    label: 'FCRA validity',
    category: 'statutory',
    check: ({ dd }) => {
      if (!dd) return { status: 'na', message: 'DD missing.' };
      const compliance = dd.compliance_check as any;
      const fcra = compliance?.mandatory?.fcra;
      if (!fcra) return { status: 'warn', message: 'FCRA check not recorded in DD.' };
      const docs = fcra.documents as any[] | undefined;
      const bad = (docs || []).find((d) => d.validation?.status === 'fail');
      if (bad) return { status: 'fail', message: 'FCRA doc validation failed — see DD.' };
      const partial = (docs || []).find((d) => d.validation?.status === 'partial');
      if (partial) return { status: 'warn', message: 'FCRA doc partially validated.' };
      const responseGiven = (fcra.responses || [])[0];
      if (!responseGiven) return { status: 'warn', message: 'FCRA registration status not answered in DD.' };
      return { status: 'pass', message: 'FCRA check passed.' };
    },
  },

  {
    id: 'statutory.reg_12a_80g',
    label: '12A and 80G registrations',
    category: 'statutory',
    check: ({ dd }) => {
      if (!dd) return { status: 'na', message: 'DD missing.' };
      const compliance = dd.compliance_check as any;
      const reg = compliance?.mandatory?.['12a-80g'];
      if (!reg) return { status: 'warn', message: '12A/80G check not recorded.' };
      const docs = reg.documents as any[] | undefined;
      const bad = (docs || []).find((d) => d.validation?.status === 'fail');
      if (bad) return { status: 'fail', message: '12A/80G doc validation failed.' };
      const responses = reg.responses as string[] | undefined;
      if (!responses || responses.some((r) => !r)) {
        return { status: 'warn', message: '12A/80G questions not fully answered.' };
      }
      return { status: 'pass', message: '12A/80G present.' };
    },
  },

  {
    id: 'statutory.tds_challan_dates',
    label: 'TDS challan dates present where TDS was paid',
    category: 'statutory',
    check: ({ dd }) => {
      if (!dd) return { status: 'na', message: 'DD missing.' };
      const statutory = dd.statutory_filings as any;
      if (!statutory) return { status: 'warn', message: 'Statutory filings not recorded.' };
      const dates: string[] = statutory.tdsChallanDates || [];
      const tds192: (string | number)[] = statutory.tds192 || [];
      const tds194j: (string | number)[] = statutory.tds194j || [];
      const tds194c: (string | number)[] = statutory.tds194c || [];
      const gaps: number[] = [];
      for (let i = 0; i < 12; i++) {
        const paid = [tds192[i], tds194j[i], tds194c[i]].some((v) => v && Number(v) > 0);
        if (paid && !dates[i]) gaps.push(i);
      }
      if (gaps.length === 0) return { status: 'pass', message: 'All months with TDS have challan dates.' };
      return {
        status: 'warn',
        message: `${gaps.length} month(s) with TDS but no challan date.`,
        details: { month_indexes: gaps },
      };
    },
  },

  {
    id: 'statutory.latest_itr_filed',
    label: 'Latest ITR filing date recorded',
    category: 'statutory',
    check: ({ dd }) => {
      if (!dd) return { status: 'na', message: 'DD missing.' };
      const statutory = dd.statutory_filings as any;
      const itr = statutory?.annualReturns?.itr;
      if (!itr) return { status: 'warn', message: 'ITR row not present in DD.' };
      const filed = parseIsoDate(itr.filingDate);
      if (!filed) return { status: 'warn', message: 'ITR filing date is blank.' };
      const age = daysSince(filed);
      if (age === null) return { status: 'warn', message: `Unparseable ITR date "${itr.filingDate}".` };
      if (age <= 400) return { status: 'pass', message: `ITR filed ${age} days ago.` };
      return { status: 'warn', message: `Latest ITR is ${age} days old — verify.` };
    },
  },

  {
    id: 'statutory.compliance_docs_pass',
    label: 'Uploaded compliance docs all validated',
    category: 'statutory',
    check: ({ dd }) => {
      if (!dd) return { status: 'na', message: 'DD missing.' };
      const compliance = dd.compliance_check as any;
      const mandatory = compliance?.mandatory || {};
      const fails: Array<{ check: string; doc: string }> = [];
      for (const [check, obj] of Object.entries(mandatory) as Array<[string, any]>) {
        for (const doc of obj.documents || []) {
          if (doc.validation?.status === 'fail') fails.push({ check, doc: doc.name });
        }
      }
      if (fails.length === 0) return { status: 'pass', message: 'No failed doc validations.' };
      return {
        status: 'fail',
        message: `${fails.length} uploaded doc(s) failed validation.`,
        details: { fails },
      };
    },
  },

  /* ── Meeting/GRM sanity ── */
  {
    id: 'meeting.grm_meeting_gap',
    label: 'GRM date sits before the committee meeting',
    category: 'coverage',
    check: ({ assembly }) => {
      if (!assembly.grm_date || !assembly.meeting_date) {
        return { status: 'na', message: 'GRM or meeting date missing.' };
      }
      const grm = Date.parse(assembly.grm_date);
      const meet = Date.parse(assembly.meeting_date);
      if (grm <= meet) return { status: 'pass', message: 'GRM is on or before the meeting.' };
      return {
        status: 'warn',
        message: 'GRM date is after the meeting date — check ordering.',
      };
    },
  },

  {
    id: 'meeting.rationale_for_delay',
    label: 'Rationale-for-delay filled if GRM > 45 days before meeting',
    category: 'coverage',
    check: ({ assembly }) => {
      if (!assembly.grm_date || !assembly.meeting_date) {
        return { status: 'na', message: 'Dates missing.' };
      }
      const gap = (Date.parse(assembly.meeting_date) - Date.parse(assembly.grm_date)) / 86_400_000;
      if (gap <= 45) return { status: 'pass', message: `Gap of ${Math.round(gap)} days is normal.` };
      if (assembly.rationale_for_delay && assembly.rationale_for_delay.trim().length > 0) {
        return { status: 'pass', message: 'Rationale provided for the delay.' };
      }
      return {
        status: 'warn',
        message: `Gap of ${Math.round(gap)} days between GRM and meeting; rationale-for-delay is blank.`,
      };
    },
  },
];
