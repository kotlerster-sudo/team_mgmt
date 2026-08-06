/**
 * Approval wizard — Zod schema for the Assessment Assembly.
 *
 * Every step of /approvals writes into one of these shapes; the deterministic
 * docx renderer in Phase 4 reads only from a validated Assembly.
 *
 * Design rules:
 *  - No free text where a picker or number would do. Where free text remains
 *    (e.g. concern rationale, condition description), it is length-capped.
 *  - Every partner-lane field is tagged implicitly by living in PartnerData.
 *  - Every RP-lane field lives in Judgement.
 *  - Finance + Budget shapes are DERIVED at confirm-time from DD + Budget,
 *    but frozen into their own tables so the docx render is a pure function.
 *  - Doc-type gating (renewal-only fields, infra-only fields, etc.) is
 *    enforced with .superRefine() at the Assembly root, not by branching the
 *    partner/judgement shapes — those stay uniform to keep the wizard code
 *    simple.
 */

import { z } from 'zod';

/* ─────────────────────────── ENUMS ─────────────────────────── */

export const DocType = z.enum([
  'standard_new',
  'standard_renewal',
  'infra',
  'network_hospital',
  'admin_note',
]);
export type DocType = z.infer<typeof DocType>;

export const Tier = z.enum(['gc', 'under_1cr']);
export type Tier = z.infer<typeof Tier>;

export const Recommendation = z.enum(['approve', 'conditional', 'decline']);

export const AssemblyStatus = z.enum([
  'draft',
  'partner_pending',
  'partner_submitted',
  'validating',
  'judging',
  'finance_confirmed',
  'budget_confirmed',
  'rendered',
  'submitted',
  'approved',
  'declined',
]);
export type AssemblyStatus = z.infer<typeof AssemblyStatus>;

export const WizardStep = z.enum([
  'setup',
  'partner',
  'validate',
  'judgement',
  'finance',
  'budget',
  'render',
]);
export type WizardStep = z.infer<typeof WizardStep>;

/* ─────────────────────── PARTNER LANE ─────────────────────── */

/* Structured address — replaces the free-text address fields in DD. */
export const Address = z.object({
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1).max(80),
  state: z.string().min(1).max(80),
  pincode: z.string().regex(/^\d{6}$/, '6-digit PIN'),
});

export const RegistrationType = z.enum(['society', 'trust', 'section_8']);

export const OrgProfile = z.object({
  legal_name: z.string().min(1).max(200),
  registered_address: Address,
  admin_office_address: Address.optional(),
  books_address: Address.optional(),
  registration_type: RegistrationType,
  registration_number: z.string().min(1).max(80),
  registration_date: z.string().date(),
  pan_number: z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'PAN format'),
  pan_date: z.string().date(),
  chief_functionary: z.object({
    name: z.string().min(1).max(120),
    phone: z.string().min(1).max(20),
    email: z.string().email().optional(),
  }),
  finance_person: z.object({
    name: z.string().min(1).max(120),
    phone: z.string().min(1).max(20),
    email: z.string().email().optional(),
  }),
});
export type OrgProfile = z.infer<typeof OrgProfile>;

/* Governing body — all previously-free-text fields become enums or numeric. */
export const BoardRole = z.enum([
  'president',
  'vice_president',
  'secretary',
  'joint_secretary',
  'treasurer',
  'member',
  'patron',
  'advisor',
  'other',
]);

export const EducationLevel = z.enum([
  'below_12',
  'class_12',
  'graduate',
  'post_graduate',
  'doctorate',
  'other',
]);

export const OccupationCategory = z.enum([
  'business',
  'service',
  'retired',
  'ngo',
  'government',
  'education',
  'other',
]);

export const PoliticalExposure = z.enum(['none', 'past', 'current']);

export const RelatedPartyLink = z.object({
  related_member_id: z.string(),
  relationship: z.enum(['spouse', 'sibling', 'parent', 'child', 'other']),
  note: z.string().max(120).optional(),
});

export const BoardMember = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  role: BoardRole,
  address_city: z.string().min(1).max(80),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
  tenure_board_years: z.number().int().nonnegative().max(80),
  tenure_position_years: z.number().int().nonnegative().max(80),
  occupation: OccupationCategory,
  education: EducationLevel,
  political_exposure: PoliticalExposure,
  related_parties: z.array(RelatedPartyLink).default([]),
  other_institutions: z
    .array(z.object({ institution: z.string().max(160), role: z.string().max(80) }))
    .default([]),
  flags: z
    .array(z.enum(['criminal_case', 'posh_concern', 'conflict_of_interest', 'other']))
    .default([]),
});

export const GoverningBody = z.array(BoardMember);
export type BoardMember = z.infer<typeof BoardMember>;

/* Funding & income — donor rows fully structured. */
export const FunderType = z.enum([
  'foundation',
  'csr',
  'government',
  'fcra_international',
  'individual',
  'other',
]);

export const FunderPurpose = z.enum([
  'nutrition',
  'early_learning',
  'wash',
  'health',
  'livelihoods',
  'education',
  'advocacy',
  'capacity_building',
  'unrestricted',
  'other',
]);

export const FunderRow = z.object({
  id: z.string(),
  funder_name: z.string().min(1).max(160),
  funder_type: FunderType,
  purpose: FunderPurpose,
  start_date: z.string().date(),
  end_date: z.string().date(),
  amounts_by_fy: z.record(z.string(), z.number().nonnegative()), // { "FY22-23": 1000000, ... }
});

export const OtherIncomeRow = z.object({
  source: z.enum(['bank_interest', 'rent', 'incidental', 'individual_donors', 'other']),
  label: z.string().max(120).optional(),
  amounts_by_fy: z.record(z.string(), z.number().nonnegative()),
});

export const Funding = z.object({
  donors: z.array(FunderRow),
  other_income: z.array(OtherIncomeRow),
});
export type FunderRow = z.infer<typeof FunderRow>;
export type OtherIncomeRow = z.infer<typeof OtherIncomeRow>;

/* Expenditure — per-FY numbers + structured foundation-supported breakdown. */
export const ExpenditureCategory = z.enum([
  'salary',
  'programme',
  'admin',
  'capital',
  'one_time_relief',
  'depreciation',
]);

export const ExpenditureRow = z.object({
  category: ExpenditureCategory,
  amounts_by_fy: z.record(z.string(), z.number().nonnegative()),
  current_fy_amount: z.number().nonnegative().optional(),
  current_fy_as_of: z.string().date().optional(),
});

export const FoundationPartnerGrant = z.object({
  partner_name: z.string().min(1).max(160),
  amount: z.number().nonnegative(),
  period_start: z.string().date(),
  period_end: z.string().date(),
});

export const Expenditure = z.object({
  overall: z.array(ExpenditureRow),
  foundation_supported: z.array(ExpenditureRow),
  foundation_partner_grants: z.array(FoundationPartnerGrant).default([]),
});
export type ExpenditureRow = z.infer<typeof ExpenditureRow>;
export type FoundationPartnerGrant = z.infer<typeof FoundationPartnerGrant>;

/* Programme design — was 6 textareas, now typed rows. */
export const VulnerablePopulation = z.enum([
  'urban_poor',
  'rural_poor',
  'tribal',
  'dalit',
  'women',
  'children_under_5',
  'children_5_18',
  'elderly',
  'pwd',
  'lgbtqia',
  'migrant',
  'homeless',
  'other',
]);

export const BeneficiaryType = z.enum([
  'child',
  'youth',
  'adult',
  'woman',
  'elder',
  'family',
  'household',
  'community',
  'other',
]);

export const PddContext = z.object({
  geography_districts: z.array(z.string().max(80)).min(1),
  vulnerable_populations: z.array(VulnerablePopulation).min(1),
  problem_statement: z.string().min(1).max(600),
  scale_metrics: z.array(
    z.object({
      metric: z.string().max(120),
      value: z.number(),
      unit: z.string().max(40),
    }),
  ),
});

export const MeasurableOutcome = z.object({
  outcome: z.string().min(1).max(200),
  beneficiary_type: BeneficiaryType,
  target_count: z.number().int().nonnegative(),
});

export const PddGoal = z.object({
  primary: z.string().min(1).max(300),
  measurable_outcomes: z.array(MeasurableOutcome).min(1),
});

export const PriorGrantSummary = z.object({
  grant_number: z.number().int().positive(),
  amount: z.number().nonnegative(),
  start_year: z.number().int(),
  end_year: z.number().int(),
  key_numeric_outcome: z.string().max(200),
});

export const PddEffect = z.object({
  id: z.string(),
  effect: z.string().min(1).max(200),
  beneficiary_type: BeneficiaryType,
  count: z.number().int().nonnegative(),
  method: z.enum(['count', 'sample_survey', 'admin_records', 'observation', 'other']),
});

export const PddIntervention = z.object({
  intervention: z.string().min(1).max(200),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'annual', 'one_time']),
  target_count: z.number().int().nonnegative(),
  responsible_role: z.string().max(120),
});

export const PddTeamRow = z.object({
  category: z.enum(['programme', 'admin', 'other']),
  role: z.string().min(1).max(120),
  count: z.number().int().nonnegative(),
  fte_pct: z.number().min(0).max(100),
});

export const PddStructured = z.object({
  context: PddContext,
  goal: PddGoal,
  history_with_foundation: z.array(PriorGrantSummary).default([]),
  effects: z.array(PddEffect).min(1),
  key_interventions: z.array(PddIntervention).min(1),
  people_involved: z.array(PddTeamRow).min(1),
});
export type PddEffect = z.infer<typeof PddEffect>;
export type PddIntervention = z.infer<typeof PddIntervention>;
export type PddTeamRow = z.infer<typeof PddTeamRow>;
export type PriorGrantSummary = z.infer<typeof PriorGrantSummary>;

export const BeneficiaryTargets = z.object({
  per_year: z.number().int().nonnegative(),
  lifetime: z.number().int().nonnegative().optional(),
  notes: z.string().max(200).optional(),
});

export const PartnerData = z.object({
  org_profile: OrgProfile,
  governing_body: GoverningBody,
  funding: Funding,
  expenditure: Expenditure,
  pdd: PddStructured,
  beneficiary_targets: BeneficiaryTargets,
});
export type PartnerData = z.infer<typeof PartnerData>;

/* ─────────────────────── JUDGEMENT LANE ─────────────────────── */

export const StrengthTag = z.enum([
  'leadership',
  'governance',
  'financial_systems',
  'delivery_discipline',
  'community_trust',
]);

export const ConcernTag = z.enum([
  'dependency',
  'turnover',
  'statutory_drift',
  'governance_thin',
  'other',
]);

export const HonestRead = z.object({
  rating: z.number().int().min(1).max(5),
  strengths: z.array(StrengthTag).default([]),
  concerns: z
    .array(
      z.object({
        category: ConcernTag,
        rationale: z.string().max(200).optional(),
      }),
    )
    .default([]),
});

/* Effect confidence keyed by PddEffect.id from Step 1. */
export const EffectConfidence = z.record(
  z.string(),
  z.object({
    confidence: z.enum(['high', 'medium', 'low']),
    note: z.string().max(200).optional(),
  }),
);

export const PriorGrantExperience = z.object({
  worked_well: z.array(
    z.enum([
      'delivery_on_time',
      'financial_reporting',
      'community_engagement',
      'staff_retention',
      'systems_improved',
      'partnerships_deepened',
      'other',
    ]),
  ),
  didnt_work: z.array(
    z.enum([
      'targets_missed',
      'reporting_delays',
      'staff_turnover',
      'financial_variance',
      'systems_stalled',
      'other',
    ]),
  ),
  overall_rating: z.number().int().min(1).max(5),
  key_learning: z.string().max(300).optional(),
});

export const RiskCategory = z.enum([
  'governance',
  'financial',
  'delivery',
  'regulatory',
  'reputational',
  'other',
]);

export const RiskEntry = z.object({
  category: RiskCategory,
  severity: z.enum(['low', 'medium', 'high']),
  note: z.string().max(200).optional(),
});

export const Condition = z.object({
  title: z.string().min(1).max(100),
  amount_linked: z.boolean().default(false),
  description: z.string().min(1).max(300),
});

export const Judgement = z.object({
  honest_read: HonestRead,
  effect_confidence: EffectConfidence,
  prior_grant_experience: PriorGrantExperience.optional(),
  risks: z.array(RiskEntry).default([]),
  recommendation: Recommendation,
  conditions: z.array(Condition).default([]),
});
export type Judgement = z.infer<typeof Judgement>;

/* ─────────────────────── FINANCE (DERIVED) ─────────────────────── */

export const DonorDiversityRow = z.object({
  funder_name: z.string(),
  funder_type: FunderType,
  origin: z.enum(['domestic', 'international']),
  amount_current: z.number().nonnegative(),
  amount_prior_2y: z.number().nonnegative(),
});

export const StatutorySummary = z.object({
  fcra_valid_until: z.string().date().nullable(),
  reg_12a_present: z.boolean(),
  reg_12a_date: z.string().date().nullable(),
  reg_80g_present: z.boolean(),
  reg_80g_date: z.string().date().nullable(),
  latest_itr_fy: z.string().nullable(),
  latest_itr_filing_date: z.string().date().nullable(),
  pending_demands: z.string().max(300).nullable(),
});

export const AccountingRating = z.object({
  system: z.enum(['manual', 'tally', 'erp']),
  monthly_close: z.boolean(),
  audit_report_url: z.string().url().nullable(),
  score: z.enum(['nascent', 'basic', 'adequate']),
});

export const AverageAnnualSpend = z.object({
  by_fy_overall: z.record(z.string(), z.number()),
  by_fy_foundation_share: z.record(z.string(), z.number()),
  average_last_3fy: z.number(),
});

export const BudgetSplitPct = z.object({
  program_salaries: z.number(),
  program: z.number(),
  travel: z.number(),
  fixed_assets: z.number(),
  admin_salaries: z.number(),
  admin_other: z.number(),
});

export const GrantSummary = z.object({
  grant_number: z.number().int().positive(),
  value_inr: z.number().nonnegative(),
  duration_months: z.number().int().positive(),
  dependency_pct: z.number().nonnegative(),
  budget_split_pct: BudgetSplitPct,
});

export const ActionPoint = z.object({
  source: z.enum(['validation_ack', 'condition']),
  title: z.string(),
  detail: z.string(),
});

export const FinanceAnnexure = z.object({
  donor_diversity: z.array(DonorDiversityRow),
  statutory: StatutorySummary,
  accounting: AccountingRating,
  spend: AverageAnnualSpend,
  grant_summary: GrantSummary,
  action_points: z.array(ActionPoint),
});
export type FinanceAnnexure = z.infer<typeof FinanceAnnexure>;

/* ─────────────────────── BUDGET (DERIVED) ─────────────────────── */

/* Deviation snapshot mirrors the shape already produced by
 * lib/review/budget-bridge.ts::BudgetComparisonSnapshot — kept as an opaque
 * jsonb here so we don't couple this schema to that internal type. */
export const BudgetDeviationSnapshot = z.record(z.string(), z.unknown());

export const CostPerBeneficiary = z.object({
  y1_total: z.number().nonnegative(),
  beneficiaries_per_year: z.number().int().positive(),
  cost_per_beneficiary: z.number().nonnegative(),
  method: z.enum(['direct', 'derived_from_seats', 'estimate']),
  caveat: z.string().max(300).optional(),
});

export const CashFlowYear = z.object({
  year_label: z.string(),
  amount: z.number().nonnegative(),
});

export const MultiYearCashFlow = z.object({
  years: z.array(CashFlowYear),
  tranches: z
    .array(z.object({ label: z.string(), start_month: z.number().int(), amount: z.number() }))
    .default([]),
});

export const PortfolioComparable = z.object({
  budget_id: z.string(),
  budget_name: z.string(),
  city: z.string(),
  domain: z.string(),
  intervention_model: z.string().nullable(),
  cost_per_beneficiary: z.number().nonnegative(),
  approved_at: z.string().date().nullable(),
  caveat: z.string().max(200),
});

export const OutlierAck = z.record(
  z.string(),
  z.object({
    decision: z.enum(['keeping', 'adjust_budget']),
    note: z.string().max(200).optional(),
  }),
);

export const BudgetAnnexure = z.object({
  budget_id: z.string(),
  deviation_snapshot: BudgetDeviationSnapshot,
  cost_per_beneficiary: CostPerBeneficiary,
  multi_year_cash_flow: MultiYearCashFlow,
  portfolio_comparables: z.array(PortfolioComparable),
  per_partner_snapshots: z.record(z.string(), BudgetDeviationSnapshot).nullable(),
  outlier_ack: OutlierAck,
});
export type BudgetAnnexure = z.infer<typeof BudgetAnnexure>;

/* ─────────────────────── VALIDATION ─────────────────────── */

export const RuleStatus = z.enum(['pass', 'warn', 'fail', 'na']);

export const RuleResult = z.object({
  rule_id: z.string(),
  label: z.string(),
  status: RuleStatus,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const ValidationAck = z.object({
  ack_by: z.string(),
  ack_at: z.string().datetime(),
  note: z.string().max(200).optional(),
});

export const ValidationRun = z.object({
  ran_at: z.string().datetime(),
  ran_by: z.string(),
  rules: z.array(RuleResult),
  acknowledgments: z.record(z.string(), ValidationAck),
});
export type ValidationRun = z.infer<typeof ValidationRun>;

/* ─────────────────────── ASSEMBLY ROOT ─────────────────────── */

export const AssemblyHeader = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  doc_type: DocType,
  tier: Tier,
  meeting_date: z.string().date().nullable(),
  presenter: z.string(),
  visitors_programme: z.array(z.string()),
  visitors_finance: z.array(z.string()),
  visit_dates_programme: z.array(z.string().date()),
  visit_dates_finance: z.array(z.string().date()),
  grm_date: z.string().date().nullable(),
  rationale_for_delay: z.string().max(500).nullable(),
  budget_id: z.string().nullable(),
  partner_email: z.string().email().or(z.literal('')),
  partner_user_id: z.string().nullable(),
  status: AssemblyStatus,
  current_step: WizardStep,
  partner_submitted_at: z.string().datetime().nullable(),
  judgement_submitted_at: z.string().datetime().nullable(),
  finance_confirmed_at: z.string().datetime().nullable(),
  budget_confirmed_at: z.string().datetime().nullable(),
  rendered_at: z.string().datetime().nullable(),
  created_by: z.string(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type AssemblyHeader = z.infer<typeof AssemblyHeader>;

/* Full assembly = header + all four lane bodies. Used by the docx renderer.
 * Uses .partial() to allow in-flight wizard states where later steps aren't
 * filled yet — the renderer enforces its own completeness check via
 * .parse(FullAssembly) after finance + budget confirmation. */
export const Assembly = z.object({
  header: AssemblyHeader,
  partner: PartnerData.optional(),
  judgement: Judgement.optional(),
  finance: FinanceAnnexure.optional(),
  budget: BudgetAnnexure.optional(),
});
export type Assembly = z.infer<typeof Assembly>;

/* Doc-type-aware completeness: the render step's precondition. */
export const RenderReadyAssembly = Assembly.superRefine((val, ctx) => {
  if (!val.partner) ctx.addIssue({ code: 'custom', message: 'Partner data missing', path: ['partner'] });
  if (!val.judgement) ctx.addIssue({ code: 'custom', message: 'Judgement missing', path: ['judgement'] });
  if (!val.finance) ctx.addIssue({ code: 'custom', message: 'Finance annexure not confirmed', path: ['finance'] });
  if (val.header.doc_type !== 'admin_note' && !val.budget) {
    ctx.addIssue({ code: 'custom', message: 'Budget annexure not confirmed', path: ['budget'] });
  }
  if (val.header.doc_type === 'standard_renewal' && !val.judgement?.prior_grant_experience) {
    ctx.addIssue({
      code: 'custom',
      message: 'Renewal requires prior_grant_experience',
      path: ['judgement', 'prior_grant_experience'],
    });
  }
});
