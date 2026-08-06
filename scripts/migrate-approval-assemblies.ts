/**
 * Approval wizard — Phase 1a foundational schema.
 *
 * Creates the six tables that back /approvals in REVIEW_DATABASE_URL:
 *   - assessment_assemblies      (root row per approval doc)
 *   - assessment_partner_data    (Step 1, partner-lane structured data)
 *   - assessment_judgement       (Step 3, RP-lane structured judgement)
 *   - assessment_finance         (Step 4, confirmed finance annexure snapshot)
 *   - assessment_budget_snapshot (Step 5, extended budget snapshot)
 *   - assessment_validation_runs (Step 2, deterministic rulebook results)
 *   - assessment_versions        (immutable step-lock audit trail)
 *
 * All idempotent. Safe to re-run.
 *
 * Run: set -a && source .env.local && set +a && npx tsx scripts/migrate-approval-assemblies.ts
 *
 * NOTE: .env.local shares the same Neon endpoint as prod ([[local_prod_shared_db]]).
 *       Treat this run as prod-touching.
 */

import { neon } from '@neondatabase/serverless';

async function main() {
  const url = process.env.REVIEW_DATABASE_URL;
  if (!url) throw new Error('REVIEW_DATABASE_URL not set');
  const sql = neon(url);

  console.log('[approvals] creating assessment_assemblies…');
  await sql`
    CREATE TABLE IF NOT EXISTS assessment_assemblies (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT,
      doc_type text NOT NULL,
      tier text NOT NULL DEFAULT 'gc',
      meeting_date date,
      presenter text NOT NULL DEFAULT '',
      visitors_programme text[] NOT NULL DEFAULT '{}',
      visitors_finance text[] NOT NULL DEFAULT '{}',
      visit_dates_programme date[] NOT NULL DEFAULT '{}',
      visit_dates_finance date[] NOT NULL DEFAULT '{}',
      grm_date date,
      rationale_for_delay text,
      budget_id text,
      partner_email text NOT NULL DEFAULT '',
      partner_user_id text,
      status text NOT NULL DEFAULT 'draft',
      current_step text NOT NULL DEFAULT 'setup',
      partner_submitted_at timestamptz,
      judgement_submitted_at timestamptz,
      finance_confirmed_at timestamptz,
      budget_confirmed_at timestamptz,
      rendered_at timestamptz,
      created_by text NOT NULL DEFAULT 'system',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS assessment_assemblies_org_idx
      ON assessment_assemblies(org_id, created_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS assessment_assemblies_status_idx
      ON assessment_assemblies(status, updated_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS assessment_assemblies_partner_idx
      ON assessment_assemblies(partner_user_id)
      WHERE partner_user_id IS NOT NULL
  `;

  console.log('[approvals] creating assessment_partner_data…');
  await sql`
    CREATE TABLE IF NOT EXISTS assessment_partner_data (
      assembly_id uuid PRIMARY KEY REFERENCES assessment_assemblies(id) ON DELETE CASCADE,
      org_profile jsonb NOT NULL DEFAULT '{}',
      governing_body jsonb NOT NULL DEFAULT '[]',
      funding jsonb NOT NULL DEFAULT '{}',
      expenditure jsonb NOT NULL DEFAULT '{}',
      pdd jsonb NOT NULL DEFAULT '{}',
      beneficiary_targets jsonb NOT NULL DEFAULT '{}',
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  console.log('[approvals] creating assessment_judgement…');
  await sql`
    CREATE TABLE IF NOT EXISTS assessment_judgement (
      assembly_id uuid PRIMARY KEY REFERENCES assessment_assemblies(id) ON DELETE CASCADE,
      honest_read jsonb NOT NULL DEFAULT '{}',
      effect_confidence jsonb NOT NULL DEFAULT '{}',
      prior_grant_experience jsonb,
      risks jsonb NOT NULL DEFAULT '[]',
      recommendation text,
      conditions jsonb NOT NULL DEFAULT '[]',
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  console.log('[approvals] creating assessment_finance…');
  await sql`
    CREATE TABLE IF NOT EXISTS assessment_finance (
      assembly_id uuid PRIMARY KEY REFERENCES assessment_assemblies(id) ON DELETE CASCADE,
      donor_diversity jsonb NOT NULL DEFAULT '{}',
      statutory_compliance jsonb NOT NULL DEFAULT '{}',
      accounting_rating jsonb NOT NULL DEFAULT '{}',
      average_annual_spend jsonb NOT NULL DEFAULT '{}',
      grant_summary jsonb NOT NULL DEFAULT '{}',
      action_points jsonb NOT NULL DEFAULT '[]',
      confirmed_at timestamptz,
      confirmed_by text
    )
  `;

  console.log('[approvals] creating assessment_budget_snapshot…');
  await sql`
    CREATE TABLE IF NOT EXISTS assessment_budget_snapshot (
      assembly_id uuid PRIMARY KEY REFERENCES assessment_assemblies(id) ON DELETE CASCADE,
      budget_id text NOT NULL,
      deviation_snapshot jsonb NOT NULL DEFAULT '{}',
      cost_per_beneficiary jsonb NOT NULL DEFAULT '{}',
      multi_year_cash_flow jsonb NOT NULL DEFAULT '{}',
      portfolio_comparables jsonb NOT NULL DEFAULT '[]',
      per_partner_snapshots jsonb,
      outlier_ack jsonb NOT NULL DEFAULT '{}',
      confirmed_at timestamptz,
      confirmed_by text
    )
  `;

  console.log('[approvals] creating assessment_validation_runs…');
  await sql`
    CREATE TABLE IF NOT EXISTS assessment_validation_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      assembly_id uuid NOT NULL REFERENCES assessment_assemblies(id) ON DELETE CASCADE,
      ran_at timestamptz NOT NULL DEFAULT now(),
      ran_by text NOT NULL DEFAULT 'system',
      rules_json jsonb NOT NULL DEFAULT '[]',
      acknowledgments_json jsonb NOT NULL DEFAULT '{}'
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS assessment_validation_runs_assembly_idx
      ON assessment_validation_runs(assembly_id, ran_at DESC)
  `;

  console.log('[approvals] creating assessment_versions…');
  await sql`
    CREATE TABLE IF NOT EXISTS assessment_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      assembly_id uuid NOT NULL REFERENCES assessment_assemblies(id) ON DELETE CASCADE,
      version_number int NOT NULL,
      trigger text NOT NULL,
      snapshot_json jsonb NOT NULL,
      created_by text NOT NULL DEFAULT 'system',
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(assembly_id, version_number)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS assessment_versions_assembly_idx
      ON assessment_versions(assembly_id, version_number DESC)
  `;

  console.log('[approvals] done.');
}

main().catch(e => { console.error(e); process.exit(1); });
