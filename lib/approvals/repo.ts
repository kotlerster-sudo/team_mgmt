/**
 * Approval assemblies — thin data-access layer over REVIEW_DATABASE_URL.
 * All CRUD lives here so API routes stay small and testable.
 */

import { sql } from '@/lib/review/db';
import type { DocType, Tier, AssemblyStatus, WizardStep } from './schema';

export type AssemblyRow = {
  id: string;
  org_id: string;
  doc_type: DocType;
  tier: Tier;
  meeting_date: string | null;
  presenter: string;
  visitors_programme: string[];
  visitors_finance: string[];
  visit_dates_programme: string[];
  visit_dates_finance: string[];
  grm_date: string | null;
  rationale_for_delay: string | null;
  budget_id: string | null;
  partner_email: string;
  partner_user_id: string | null;
  status: AssemblyStatus;
  current_step: WizardStep;
  partner_submitted_at: string | null;
  judgement_submitted_at: string | null;
  finance_confirmed_at: string | null;
  budget_confirmed_at: string | null;
  rendered_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type AssemblyListRow = AssemblyRow & { org_name: string; org_city: string };

export type CreateAssemblyInput = {
  org_id: string;
  doc_type: DocType;
  tier: Tier;
  meeting_date: string | null;
  presenter: string;
  visitors_programme: string[];
  visitors_finance: string[];
  visit_dates_programme: string[];
  visit_dates_finance: string[];
  grm_date: string | null;
  rationale_for_delay: string | null;
  partner_user_id: string | null;
  partner_email: string;
  created_by: string;
};

export async function createAssembly(input: CreateAssemblyInput): Promise<AssemblyRow> {
  const rows = (await sql`
    INSERT INTO assessment_assemblies (
      org_id, doc_type, tier, meeting_date, presenter,
      visitors_programme, visitors_finance, visit_dates_programme, visit_dates_finance,
      grm_date, rationale_for_delay,
      partner_user_id, partner_email,
      status, current_step, created_by
    ) VALUES (
      ${input.org_id}, ${input.doc_type}, ${input.tier}, ${input.meeting_date}, ${input.presenter},
      ${input.visitors_programme}, ${input.visitors_finance},
      ${input.visit_dates_programme}, ${input.visit_dates_finance},
      ${input.grm_date}, ${input.rationale_for_delay},
      ${input.partner_user_id}, ${input.partner_email},
      'partner_pending', 'partner', ${input.created_by}
    )
    RETURNING *
  `) as AssemblyRow[];
  return rows[0];
}

export async function getAssembly(id: string): Promise<AssemblyRow | null> {
  const rows = (await sql`
    SELECT * FROM assessment_assemblies WHERE id = ${id} LIMIT 1
  `) as AssemblyRow[];
  return rows[0] ?? null;
}

export async function listAssemblies(): Promise<AssemblyListRow[]> {
  return (await sql`
    SELECT a.*, o.name AS org_name, o.city AS org_city
    FROM assessment_assemblies a
    JOIN orgs o ON o.id = a.org_id
    ORDER BY a.updated_at DESC
    LIMIT 200
  `) as AssemblyListRow[];
}

export async function listAssembliesForPartner(partnerUserId: string): Promise<AssemblyListRow[]> {
  return (await sql`
    SELECT a.*, o.name AS org_name, o.city AS org_city
    FROM assessment_assemblies a
    JOIN orgs o ON o.id = a.org_id
    WHERE a.partner_user_id = ${partnerUserId}
    ORDER BY a.updated_at DESC
  `) as AssemblyListRow[];
}

/** Pending = invited but partner hasn't submitted Step 1 yet. Used by the
 *  banner on /budget so partners find the wizard without knowing the URL. */
export async function listPendingForPartner(partnerUserId: string): Promise<AssemblyListRow[]> {
  return (await sql`
    SELECT a.*, o.name AS org_name, o.city AS org_city
    FROM assessment_assemblies a
    JOIN orgs o ON o.id = a.org_id
    WHERE a.partner_user_id = ${partnerUserId}
      AND a.partner_submitted_at IS NULL
    ORDER BY a.updated_at DESC
  `) as AssemblyListRow[];
}

/** Assembly + ownership check for a partner user. Returns null if not theirs. */
export async function getAssemblyForPartnerUser(
  id: string,
  partnerUserId: string,
): Promise<AssemblyListRow | null> {
  const rows = (await sql`
    SELECT a.*, o.name AS org_name, o.city AS org_city
    FROM assessment_assemblies a
    JOIN orgs o ON o.id = a.org_id
    WHERE a.id = ${id} AND a.partner_user_id = ${partnerUserId}
    LIMIT 1
  `) as AssemblyListRow[];
  return rows[0] ?? null;
}

/* ─────── Partner data (Step 1) ─────── */

export type PartnerDataRow = {
  assembly_id: string;
  org_profile: unknown;
  governing_body: unknown;
  funding: unknown;
  expenditure: unknown;
  pdd: unknown;
  beneficiary_targets: unknown;
  updated_at: string;
};

export async function getPartnerData(assemblyId: string): Promise<PartnerDataRow | null> {
  const rows = (await sql`
    SELECT * FROM assessment_partner_data WHERE assembly_id = ${assemblyId} LIMIT 1
  `) as PartnerDataRow[];
  return rows[0] ?? null;
}

export type PartnerDataUpsertInput = {
  org_profile?: unknown;
  governing_body?: unknown;
  funding?: unknown;
  expenditure?: unknown;
  pdd?: unknown;
  beneficiary_targets?: unknown;
};

/**
 * COALESCE-style upsert — only overwrites keys the caller passes. This lets
 * the partner form auto-save section-by-section without stomping the others.
 */
export async function upsertPartnerData(
  assemblyId: string,
  input: PartnerDataUpsertInput,
): Promise<void> {
  const existing = await getPartnerData(assemblyId);
  const next = {
    org_profile: input.org_profile !== undefined ? input.org_profile : existing?.org_profile ?? {},
    governing_body:
      input.governing_body !== undefined ? input.governing_body : existing?.governing_body ?? [],
    funding: input.funding !== undefined ? input.funding : existing?.funding ?? {},
    expenditure:
      input.expenditure !== undefined ? input.expenditure : existing?.expenditure ?? {},
    pdd: input.pdd !== undefined ? input.pdd : existing?.pdd ?? {},
    beneficiary_targets:
      input.beneficiary_targets !== undefined
        ? input.beneficiary_targets
        : existing?.beneficiary_targets ?? {},
  };
  if (existing) {
    await sql`
      UPDATE assessment_partner_data
      SET org_profile = ${JSON.stringify(next.org_profile)}::jsonb,
          governing_body = ${JSON.stringify(next.governing_body)}::jsonb,
          funding = ${JSON.stringify(next.funding)}::jsonb,
          expenditure = ${JSON.stringify(next.expenditure)}::jsonb,
          pdd = ${JSON.stringify(next.pdd)}::jsonb,
          beneficiary_targets = ${JSON.stringify(next.beneficiary_targets)}::jsonb,
          updated_at = now()
      WHERE assembly_id = ${assemblyId}
    `;
  } else {
    await sql`
      INSERT INTO assessment_partner_data
        (assembly_id, org_profile, governing_body, funding, expenditure, pdd, beneficiary_targets)
      VALUES
        (${assemblyId},
         ${JSON.stringify(next.org_profile)}::jsonb,
         ${JSON.stringify(next.governing_body)}::jsonb,
         ${JSON.stringify(next.funding)}::jsonb,
         ${JSON.stringify(next.expenditure)}::jsonb,
         ${JSON.stringify(next.pdd)}::jsonb,
         ${JSON.stringify(next.beneficiary_targets)}::jsonb)
    `;
  }
  await sql`UPDATE assessment_assemblies SET updated_at = now() WHERE id = ${assemblyId}`;
}

/**
 * Lock partner step: stamp partner_submitted_at, flip status → 'partner_submitted',
 * current_step → 'validate', and write an immutable version snapshot.
 */
export async function lockPartnerStep(assemblyId: string, actorUserId: string): Promise<void> {
  const data = await getPartnerData(assemblyId);
  const asm = await getAssembly(assemblyId);
  if (!asm) throw new Error('assembly not found');

  const snapshot = { header: asm, partner: data };

  // Version number = max + 1
  const rows = (await sql`
    SELECT COALESCE(MAX(version_number), 0) + 1 AS next_num
    FROM assessment_versions WHERE assembly_id = ${assemblyId}
  `) as { next_num: number }[];
  const nextNum = rows[0]?.next_num ?? 1;

  await sql`
    INSERT INTO assessment_versions
      (assembly_id, version_number, trigger, snapshot_json, created_by)
    VALUES
      (${assemblyId}, ${nextNum}, 'partner_submit', ${JSON.stringify(snapshot)}::jsonb, ${actorUserId})
  `;

  await sql`
    UPDATE assessment_assemblies
    SET status = 'partner_submitted',
        current_step = 'validate',
        partner_submitted_at = now(),
        updated_at = now()
    WHERE id = ${assemblyId}
  `;
}

/**
 * Reopen partner step — admin correction path. Clears partner_submitted_at,
 * flips status/step back to partner_pending/partner. A version snapshot is
 * written so the reopen itself is auditable.
 */
export async function reopenPartnerStep(assemblyId: string, actorUserId: string, reason: string): Promise<void> {
  const asm = await getAssembly(assemblyId);
  if (!asm) throw new Error('assembly not found');
  const data = await getPartnerData(assemblyId);

  const rows = (await sql`
    SELECT COALESCE(MAX(version_number), 0) + 1 AS next_num
    FROM assessment_versions WHERE assembly_id = ${assemblyId}
  `) as { next_num: number }[];
  const nextNum = rows[0]?.next_num ?? 1;

  await sql`
    INSERT INTO assessment_versions
      (assembly_id, version_number, trigger, snapshot_json, created_by)
    VALUES
      (${assemblyId}, ${nextNum}, 'partner_reopen',
       ${JSON.stringify({ header: asm, partner: data, reason })}::jsonb,
       ${actorUserId})
  `;

  await sql`
    UPDATE assessment_assemblies
    SET status = 'partner_pending',
        current_step = 'partner',
        partner_submitted_at = NULL,
        updated_at = now()
    WHERE id = ${assemblyId}
  `;
}

/* ─────── Versions ─────── */

export type VersionRow = {
  id: string;
  assembly_id: string;
  version_number: number;
  trigger: string;
  snapshot_json: unknown;
  created_by: string;
  created_at: string;
};

/**
 * Stamp rendered_at + status → 'rendered' (idempotent). Called after a
 * successful docx download; writes a version snapshot to record the event.
 */
export async function markRendered(assemblyId: string, actorUserId: string): Promise<void> {
  const asm = await getAssembly(assemblyId);
  if (!asm) throw new Error('assembly not found');
  if (asm.rendered_at) return; // idempotent

  const versionRows = (await sql`
    SELECT COALESCE(MAX(version_number), 0) + 1 AS next_num
    FROM assessment_versions WHERE assembly_id = ${assemblyId}
  `) as { next_num: number }[];

  await sql`
    INSERT INTO assessment_versions
      (assembly_id, version_number, trigger, snapshot_json, created_by)
    VALUES
      (${assemblyId}, ${versionRows[0].next_num}, 'render',
       ${JSON.stringify({ header: asm })}::jsonb,
       ${actorUserId})
  `;

  await sql`
    UPDATE assessment_assemblies
    SET status = 'rendered',
        rendered_at = now(),
        updated_at = now()
    WHERE id = ${assemblyId}
  `;
}

/**
 * RP hits "Submit to meeting" after rendering — flips status → 'submitted'.
 */
export async function markSubmittedToMeeting(assemblyId: string): Promise<void> {
  await sql`
    UPDATE assessment_assemblies
    SET status = 'submitted', updated_at = now()
    WHERE id = ${assemblyId} AND rendered_at IS NOT NULL
  `;
}

export async function listVersions(assemblyId: string): Promise<VersionRow[]> {
  return (await sql`
    SELECT * FROM assessment_versions
    WHERE assembly_id = ${assemblyId}
    ORDER BY version_number DESC
    LIMIT 50
  `) as VersionRow[];
}

/* ─────── Judgement (Step 3) ─────── */

export type JudgementRow = {
  assembly_id: string;
  honest_read: unknown;
  effect_confidence: unknown;
  prior_grant_experience: unknown;
  risks: unknown;
  recommendation: string | null;
  conditions: unknown;
  updated_at: string;
};

export async function getJudgement(assemblyId: string): Promise<JudgementRow | null> {
  const rows = (await sql`
    SELECT * FROM assessment_judgement WHERE assembly_id = ${assemblyId} LIMIT 1
  `) as JudgementRow[];
  return rows[0] ?? null;
}

export type JudgementUpsertInput = {
  honest_read?: unknown;
  effect_confidence?: unknown;
  prior_grant_experience?: unknown;
  risks?: unknown;
  recommendation?: string | null;
  conditions?: unknown;
};

export async function upsertJudgement(
  assemblyId: string,
  input: JudgementUpsertInput,
): Promise<void> {
  const existing = await getJudgement(assemblyId);
  const next = {
    honest_read: input.honest_read !== undefined ? input.honest_read : existing?.honest_read ?? {},
    effect_confidence:
      input.effect_confidence !== undefined ? input.effect_confidence : existing?.effect_confidence ?? {},
    prior_grant_experience:
      input.prior_grant_experience !== undefined
        ? input.prior_grant_experience
        : existing?.prior_grant_experience ?? null,
    risks: input.risks !== undefined ? input.risks : existing?.risks ?? [],
    recommendation:
      input.recommendation !== undefined ? input.recommendation : existing?.recommendation ?? null,
    conditions: input.conditions !== undefined ? input.conditions : existing?.conditions ?? [],
  };
  if (existing) {
    await sql`
      UPDATE assessment_judgement
      SET honest_read = ${JSON.stringify(next.honest_read)}::jsonb,
          effect_confidence = ${JSON.stringify(next.effect_confidence)}::jsonb,
          prior_grant_experience = ${next.prior_grant_experience === null ? null : JSON.stringify(next.prior_grant_experience)}::jsonb,
          risks = ${JSON.stringify(next.risks)}::jsonb,
          recommendation = ${next.recommendation},
          conditions = ${JSON.stringify(next.conditions)}::jsonb,
          updated_at = now()
      WHERE assembly_id = ${assemblyId}
    `;
  } else {
    await sql`
      INSERT INTO assessment_judgement
        (assembly_id, honest_read, effect_confidence, prior_grant_experience,
         risks, recommendation, conditions)
      VALUES
        (${assemblyId},
         ${JSON.stringify(next.honest_read)}::jsonb,
         ${JSON.stringify(next.effect_confidence)}::jsonb,
         ${next.prior_grant_experience === null ? null : JSON.stringify(next.prior_grant_experience)}::jsonb,
         ${JSON.stringify(next.risks)}::jsonb,
         ${next.recommendation},
         ${JSON.stringify(next.conditions)}::jsonb)
    `;
  }
  await sql`UPDATE assessment_assemblies SET updated_at = now() WHERE id = ${assemblyId}`;
}

/* ─────── Finance (Step 4) ─────── */

export type FinanceRow = {
  assembly_id: string;
  donor_diversity: unknown;
  statutory_compliance: unknown;
  accounting_rating: unknown;
  average_annual_spend: unknown;
  grant_summary: unknown;
  action_points: unknown;
  confirmed_at: string | null;
  confirmed_by: string | null;
};

export async function getFinance(assemblyId: string): Promise<FinanceRow | null> {
  const rows = (await sql`
    SELECT * FROM assessment_finance WHERE assembly_id = ${assemblyId} LIMIT 1
  `) as FinanceRow[];
  return rows[0] ?? null;
}

/** RP-owned inputs: accounting rating + grant summary. Merged with existing. */
export type FinanceInputPatch = {
  accounting_rating?: unknown;
  grant_summary?: unknown;
};

export async function upsertFinanceInput(
  assemblyId: string,
  patch: FinanceInputPatch,
): Promise<void> {
  const existing = await getFinance(assemblyId);
  const next = {
    accounting_rating:
      patch.accounting_rating !== undefined
        ? patch.accounting_rating
        : existing?.accounting_rating ?? {},
    grant_summary:
      patch.grant_summary !== undefined ? patch.grant_summary : existing?.grant_summary ?? {},
  };
  if (existing) {
    await sql`
      UPDATE assessment_finance
      SET accounting_rating = ${JSON.stringify(next.accounting_rating)}::jsonb,
          grant_summary = ${JSON.stringify(next.grant_summary)}::jsonb
      WHERE assembly_id = ${assemblyId}
    `;
  } else {
    await sql`
      INSERT INTO assessment_finance
        (assembly_id, accounting_rating, grant_summary)
      VALUES
        (${assemblyId},
         ${JSON.stringify(next.accounting_rating)}::jsonb,
         ${JSON.stringify(next.grant_summary)}::jsonb)
    `;
  }
  await sql`UPDATE assessment_assemblies SET updated_at = now() WHERE id = ${assemblyId}`;
}

/* ─────── Budget (Step 5) ─────── */

export type BudgetSnapshotRow = {
  assembly_id: string;
  budget_id: string;
  deviation_snapshot: unknown;
  cost_per_beneficiary: unknown;
  multi_year_cash_flow: unknown;
  portfolio_comparables: unknown;
  per_partner_snapshots: unknown;
  outlier_ack: unknown;
  confirmed_at: string | null;
  confirmed_by: string | null;
};

export async function getBudgetSnapshot(assemblyId: string): Promise<BudgetSnapshotRow | null> {
  const rows = (await sql`
    SELECT * FROM assessment_budget_snapshot WHERE assembly_id = ${assemblyId} LIMIT 1
  `) as BudgetSnapshotRow[];
  return rows[0] ?? null;
}

export async function upsertBudgetSnapshot(
  assemblyId: string,
  budgetId: string,
  derived: {
    deviation_snapshot: unknown;
    cost_per_beneficiary: unknown;
    multi_year_cash_flow: unknown;
    portfolio_comparables: unknown;
    per_partner_snapshots: unknown;
  },
): Promise<void> {
  await sql`
    INSERT INTO assessment_budget_snapshot
      (assembly_id, budget_id, deviation_snapshot, cost_per_beneficiary,
       multi_year_cash_flow, portfolio_comparables, per_partner_snapshots)
    VALUES
      (${assemblyId}, ${budgetId},
       ${JSON.stringify(derived.deviation_snapshot)}::jsonb,
       ${JSON.stringify(derived.cost_per_beneficiary)}::jsonb,
       ${JSON.stringify(derived.multi_year_cash_flow)}::jsonb,
       ${JSON.stringify(derived.portfolio_comparables)}::jsonb,
       ${derived.per_partner_snapshots === null ? null : JSON.stringify(derived.per_partner_snapshots)}::jsonb)
    ON CONFLICT (assembly_id) DO UPDATE
    SET budget_id = EXCLUDED.budget_id,
        deviation_snapshot = EXCLUDED.deviation_snapshot,
        cost_per_beneficiary = EXCLUDED.cost_per_beneficiary,
        multi_year_cash_flow = EXCLUDED.multi_year_cash_flow,
        portfolio_comparables = EXCLUDED.portfolio_comparables,
        per_partner_snapshots = EXCLUDED.per_partner_snapshots
  `;
  await sql`UPDATE assessment_assemblies SET budget_id = ${budgetId}, updated_at = now() WHERE id = ${assemblyId}`;
}

export async function upsertOutlierAck(
  assemblyId: string,
  templateKey: string,
  ack: { decision: 'keeping' | 'adjust_budget'; note?: string },
): Promise<void> {
  const row = await getBudgetSnapshot(assemblyId);
  if (!row) throw new Error('Link a budget first.');
  const cur = (row.outlier_ack as Record<string, unknown>) || {};
  const next = { ...cur, [templateKey]: ack };
  await sql`
    UPDATE assessment_budget_snapshot
    SET outlier_ack = ${JSON.stringify(next)}::jsonb
    WHERE assembly_id = ${assemblyId}
  `;
}

export async function freezeBudget(assemblyId: string, actorUserId: string): Promise<void> {
  const asm = await getAssembly(assemblyId);
  if (!asm) throw new Error('assembly not found');
  const row = await getBudgetSnapshot(assemblyId);
  if (!row) throw new Error('Nothing to confirm — link a budget first.');

  const versionRows = (await sql`
    SELECT COALESCE(MAX(version_number), 0) + 1 AS next_num
    FROM assessment_versions WHERE assembly_id = ${assemblyId}
  `) as { next_num: number }[];

  await sql`
    INSERT INTO assessment_versions
      (assembly_id, version_number, trigger, snapshot_json, created_by)
    VALUES
      (${assemblyId}, ${versionRows[0].next_num}, 'budget_confirm',
       ${JSON.stringify({ header: asm, budget: row })}::jsonb,
       ${actorUserId})
  `;

  await sql`
    UPDATE assessment_budget_snapshot
    SET confirmed_at = now(), confirmed_by = ${actorUserId}
    WHERE assembly_id = ${assemblyId}
  `;

  await sql`
    UPDATE assessment_assemblies
    SET status = 'budget_confirmed',
        current_step = 'render',
        budget_confirmed_at = now(),
        updated_at = now()
    WHERE id = ${assemblyId}
  `;
}

/** Freeze the fully-derived annexure into the row + snapshot + advance. */
export async function freezeFinance(
  assemblyId: string,
  actorUserId: string,
  derived: {
    donor_diversity: unknown;
    statutory_compliance: unknown;
    accounting_rating: unknown;
    average_annual_spend: unknown;
    grant_summary: unknown;
    action_points: unknown;
  },
): Promise<void> {
  const asm = await getAssembly(assemblyId);
  if (!asm) throw new Error('assembly not found');

  await sql`
    INSERT INTO assessment_finance
      (assembly_id, donor_diversity, statutory_compliance, accounting_rating,
       average_annual_spend, grant_summary, action_points, confirmed_at, confirmed_by)
    VALUES
      (${assemblyId},
       ${JSON.stringify(derived.donor_diversity)}::jsonb,
       ${JSON.stringify(derived.statutory_compliance)}::jsonb,
       ${JSON.stringify(derived.accounting_rating)}::jsonb,
       ${JSON.stringify(derived.average_annual_spend)}::jsonb,
       ${JSON.stringify(derived.grant_summary)}::jsonb,
       ${JSON.stringify(derived.action_points)}::jsonb,
       now(), ${actorUserId})
    ON CONFLICT (assembly_id) DO UPDATE
    SET donor_diversity = EXCLUDED.donor_diversity,
        statutory_compliance = EXCLUDED.statutory_compliance,
        accounting_rating = EXCLUDED.accounting_rating,
        average_annual_spend = EXCLUDED.average_annual_spend,
        grant_summary = EXCLUDED.grant_summary,
        action_points = EXCLUDED.action_points,
        confirmed_at = EXCLUDED.confirmed_at,
        confirmed_by = EXCLUDED.confirmed_by
  `;

  const versionRows = (await sql`
    SELECT COALESCE(MAX(version_number), 0) + 1 AS next_num
    FROM assessment_versions WHERE assembly_id = ${assemblyId}
  `) as { next_num: number }[];

  await sql`
    INSERT INTO assessment_versions
      (assembly_id, version_number, trigger, snapshot_json, created_by)
    VALUES
      (${assemblyId}, ${versionRows[0].next_num}, 'finance_confirm',
       ${JSON.stringify({ header: asm, finance: derived })}::jsonb,
       ${actorUserId})
  `;

  await sql`
    UPDATE assessment_assemblies
    SET status = 'finance_confirmed',
        current_step = 'budget',
        finance_confirmed_at = now(),
        updated_at = now()
    WHERE id = ${assemblyId}
  `;
}

export async function lockJudgement(assemblyId: string, actorUserId: string): Promise<void> {
  const asm = await getAssembly(assemblyId);
  if (!asm) throw new Error('assembly not found');
  const j = await getJudgement(assemblyId);

  const versionRows = (await sql`
    SELECT COALESCE(MAX(version_number), 0) + 1 AS next_num
    FROM assessment_versions WHERE assembly_id = ${assemblyId}
  `) as { next_num: number }[];

  await sql`
    INSERT INTO assessment_versions
      (assembly_id, version_number, trigger, snapshot_json, created_by)
    VALUES
      (${assemblyId}, ${versionRows[0].next_num}, 'judgement_submit',
       ${JSON.stringify({ header: asm, judgement: j })}::jsonb,
       ${actorUserId})
  `;

  await sql`
    UPDATE assessment_assemblies
    SET status = 'judging',
        current_step = 'finance',
        judgement_submitted_at = now(),
        updated_at = now()
    WHERE id = ${assemblyId}
  `;
}
