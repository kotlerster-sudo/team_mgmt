/**
 * Executes the validation rulebook against a single assembly.
 * Loads assembly + partner_data + DD (if any) + budget snapshot (if any),
 * runs every rule, persists the result set into assessment_validation_runs.
 *
 * Idempotent from the caller's perspective — each POST creates a fresh run
 * row. The Step 2 UI shows the LATEST run.
 */

import { sql } from '@/lib/review/db';
import { getAssembly, getPartnerData, type AssemblyRow } from '../repo';
import { PartnerData } from '../schema';
import { RULES } from './rulebook';
import type { RuleResult, RuleContext } from './types';

async function loadDdForOrg(orgId: string): Promise<Record<string, unknown> | null> {
  const rows = (await sql`
    SELECT org_profile, governing_body, compliance_check, statutory_filings,
           salary_details, funding_income, expenditure, pdd, completed_stages
    FROM org_due_diligence
    WHERE org_id = ${orgId}
    LIMIT 1
  `) as Record<string, unknown>[];
  return rows[0] ?? null;
}

async function loadBudgetSnapshot(assemblyId: string): Promise<Record<string, unknown> | null> {
  const rows = (await sql`
    SELECT * FROM assessment_budget_snapshot WHERE assembly_id = ${assemblyId} LIMIT 1
  `) as Record<string, unknown>[];
  return rows[0] ?? null;
}

export type ValidationRunSummary = {
  run_id: string;
  ran_at: string;
  results: RuleResult[];
  counts: { pass: number; warn: number; fail: number; na: number };
};

export async function runValidation(
  assemblyId: string,
  actorUserId: string,
): Promise<ValidationRunSummary> {
  const assembly = await getAssembly(assemblyId);
  if (!assembly) throw new Error('assembly not found');

  const partnerRow = await getPartnerData(assemblyId);
  if (!partnerRow) {
    throw new Error('Step 1 is empty — nothing to validate.');
  }

  const parsed = PartnerData.safeParse({
    org_profile: partnerRow.org_profile,
    governing_body: partnerRow.governing_body,
    funding: partnerRow.funding,
    expenditure: partnerRow.expenditure,
    pdd: partnerRow.pdd,
    beneficiary_targets: partnerRow.beneficiary_targets,
  });
  if (!parsed.success) {
    // Partner data present but not schema-clean. Emit a single fail so the
    // RP knows to reopen Step 1 rather than proceed on bad data.
    const results: RuleResult[] = [
      {
        rule_id: 'coverage.partner_data_zod',
        label: 'Partner data passes schema validation',
        category: 'coverage',
        status: 'fail',
        message: 'Partner data no longer matches the schema — reopen Step 1.',
        details: { issues: parsed.error.issues.slice(0, 20) },
      },
    ];
    return persistRun(assemblyId, actorUserId, results);
  }

  const ctx: RuleContext = {
    assembly: assembly as AssemblyRow,
    partner: parsed.data,
    dd: await loadDdForOrg(assembly.org_id),
    budget: await loadBudgetSnapshot(assemblyId),
  };

  const results: RuleResult[] = RULES.map((r) => {
    try {
      const out = r.check(ctx);
      return { rule_id: r.id, label: r.label, category: r.category, ...out };
    } catch (e) {
      return {
        rule_id: r.id,
        label: r.label,
        category: r.category,
        status: 'fail',
        message: `Rule threw: ${(e as Error).message}`,
      };
    }
  });

  return persistRun(assemblyId, actorUserId, results);
}

async function persistRun(
  assemblyId: string,
  actorUserId: string,
  results: RuleResult[],
): Promise<ValidationRunSummary> {
  const rows = (await sql`
    INSERT INTO assessment_validation_runs
      (assembly_id, ran_by, rules_json, acknowledgments_json)
    VALUES
      (${assemblyId}, ${actorUserId}, ${JSON.stringify(results)}::jsonb, '{}'::jsonb)
    RETURNING id, ran_at
  `) as { id: string; ran_at: string }[];

  const counts = { pass: 0, warn: 0, fail: 0, na: 0 };
  for (const r of results) counts[r.status]++;

  // Flip status → 'validating' once a run exists (idempotent).
  await sql`
    UPDATE assessment_assemblies
    SET status = CASE WHEN status = 'partner_submitted' THEN 'validating' ELSE status END,
        updated_at = now()
    WHERE id = ${assemblyId}
  `;

  return { run_id: rows[0].id, ran_at: rows[0].ran_at, results, counts };
}

export type ValidationLatest = {
  run: {
    id: string;
    ran_at: string;
    ran_by: string;
    results: RuleResult[];
    acknowledgments: Record<string, { ack_by: string; ack_at: string; note?: string }>;
  } | null;
  counts: { pass: number; warn: number; fail: number; na: number; acknowledged: number };
  unresolved_count: number;
};

export async function loadLatestRun(assemblyId: string): Promise<ValidationLatest> {
  const rows = (await sql`
    SELECT id, ran_at, ran_by, rules_json, acknowledgments_json
    FROM assessment_validation_runs
    WHERE assembly_id = ${assemblyId}
    ORDER BY ran_at DESC
    LIMIT 1
  `) as Array<{
    id: string;
    ran_at: string;
    ran_by: string;
    rules_json: unknown;
    acknowledgments_json: unknown;
  }>;

  if (rows.length === 0) {
    return {
      run: null,
      counts: { pass: 0, warn: 0, fail: 0, na: 0, acknowledged: 0 },
      unresolved_count: 0,
    };
  }

  const r = rows[0];
  const results = (r.rules_json as RuleResult[]) || [];
  const acks =
    (r.acknowledgments_json as Record<string, { ack_by: string; ack_at: string; note?: string }>) || {};
  const counts = { pass: 0, warn: 0, fail: 0, na: 0, acknowledged: 0 };
  let unresolved = 0;
  for (const rr of results) {
    counts[rr.status]++;
    if (rr.status === 'warn' || rr.status === 'fail') {
      if (acks[rr.rule_id]) counts.acknowledged++;
      else unresolved++;
    }
  }

  return {
    run: {
      id: r.id,
      ran_at: r.ran_at,
      ran_by: r.ran_by,
      results,
      acknowledgments: acks,
    },
    counts,
    unresolved_count: unresolved,
  };
}

export async function ackRule(
  assemblyId: string,
  ruleId: string,
  actorUserId: string,
  note?: string,
): Promise<void> {
  const latest = await loadLatestRun(assemblyId);
  if (!latest.run) throw new Error('No validation run to acknowledge.');
  const nextAcks = {
    ...latest.run.acknowledgments,
    [ruleId]: { ack_by: actorUserId, ack_at: new Date().toISOString(), note },
  };
  await sql`
    UPDATE assessment_validation_runs
    SET acknowledgments_json = ${JSON.stringify(nextAcks)}::jsonb
    WHERE id = ${latest.run.id}
  `;
}

export async function unackRule(assemblyId: string, ruleId: string): Promise<void> {
  const latest = await loadLatestRun(assemblyId);
  if (!latest.run) return;
  const { [ruleId]: _dropped, ...rest } = latest.run.acknowledgments;
  void _dropped;
  await sql`
    UPDATE assessment_validation_runs
    SET acknowledgments_json = ${JSON.stringify(rest)}::jsonb
    WHERE id = ${latest.run.id}
  `;
}

/**
 * Advance step: only allowed if latest run has zero unresolved warn/fail.
 * Snapshots a version and moves current_step → judgement.
 */
export async function advancePastValidate(
  assemblyId: string,
  actorUserId: string,
): Promise<void> {
  const latest = await loadLatestRun(assemblyId);
  if (!latest.run) throw new Error('Run validation first.');
  if (latest.unresolved_count > 0) {
    throw new Error(
      `${latest.unresolved_count} rule(s) still need acknowledgment before advancing.`,
    );
  }

  const asm = await getAssembly(assemblyId);
  if (!asm) throw new Error('assembly missing');

  const versionRows = (await sql`
    SELECT COALESCE(MAX(version_number), 0) + 1 AS next_num
    FROM assessment_versions WHERE assembly_id = ${assemblyId}
  `) as { next_num: number }[];

  await sql`
    INSERT INTO assessment_versions
      (assembly_id, version_number, trigger, snapshot_json, created_by)
    VALUES
      (${assemblyId}, ${versionRows[0].next_num}, 'validate_advance',
       ${JSON.stringify({ header: asm, validation: latest })}::jsonb,
       ${actorUserId})
  `;

  await sql`
    UPDATE assessment_assemblies
    SET status = 'judging', current_step = 'judgement', updated_at = now()
    WHERE id = ${assemblyId}
  `;
}
