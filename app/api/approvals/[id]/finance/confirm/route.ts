/**
 * POST /api/approvals/[id]/finance/confirm
 * Re-derives from the latest inputs, freezes into assessment_finance,
 * snapshots a version, and moves current_step → budget.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/roleGuard';
import { sql } from '@/lib/review/db';
import {
  getAssembly,
  getPartnerData,
  getJudgement,
  getFinance,
  freezeFinance,
} from '@/lib/approvals/repo';
import { PartnerData, Judgement } from '@/lib/approvals/schema';
import { loadLatestRun } from '@/lib/approvals/validation/runner';
import { deriveFinance, type FinanceRpInput } from '@/lib/approvals/finance/derive';

async function loadDd(orgId: string) {
  const rows = (await sql`
    SELECT org_profile, governing_body, compliance_check, statutory_filings,
           salary_details, funding_income, expenditure, pdd
    FROM org_due_diligence WHERE org_id = ${orgId} LIMIT 1
  `) as Record<string, unknown>[];
  return rows[0] ?? null;
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!isSuperAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const asm = await getAssembly(id);
  if (!asm) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (asm.finance_confirmed_at) {
    return NextResponse.json({ error: 'Already confirmed' }, { status: 409 });
  }

  const [partnerRow, judgementRow, financeRow, validation] = await Promise.all([
    getPartnerData(id),
    getJudgement(id),
    getFinance(id),
    loadLatestRun(id),
  ]);
  if (!partnerRow) return NextResponse.json({ error: 'Step 1 empty' }, { status: 400 });
  if (!financeRow || !financeRow.accounting_rating || !financeRow.grant_summary) {
    return NextResponse.json(
      { error: 'Fill accounting rating and grant summary before confirming.' },
      { status: 400 },
    );
  }

  const partnerParsed = PartnerData.safeParse({
    org_profile: partnerRow.org_profile,
    governing_body: partnerRow.governing_body,
    funding: partnerRow.funding,
    expenditure: partnerRow.expenditure,
    pdd: partnerRow.pdd,
    beneficiary_targets: partnerRow.beneficiary_targets,
  });
  if (!partnerParsed.success) {
    return NextResponse.json({ error: 'Partner data is invalid' }, { status: 400 });
  }
  const judgementParsed = judgementRow
    ? Judgement.safeParse({
        honest_read: judgementRow.honest_read,
        effect_confidence: judgementRow.effect_confidence,
        prior_grant_experience: judgementRow.prior_grant_experience ?? undefined,
        risks: judgementRow.risks,
        recommendation: judgementRow.recommendation,
        conditions: judgementRow.conditions,
      })
    : null;

  const dd = await loadDd(asm.org_id);
  const rpInput = {
    accounting: financeRow.accounting_rating as FinanceRpInput['accounting'],
    grant_summary: financeRow.grant_summary as FinanceRpInput['grant_summary'],
  };

  const derived = deriveFinance({
    assembly: asm,
    partner: partnerParsed.data,
    dd,
    judgement: judgementParsed?.success ? judgementParsed.data : null,
    validation: validation.run
      ? { results: validation.run.results, acknowledgments: validation.run.acknowledgments }
      : null,
    rpInput,
  });

  await freezeFinance(id, session!.user!.id!, {
    donor_diversity: derived.donor_diversity,
    statutory_compliance: derived.statutory,
    accounting_rating: derived.accounting,
    average_annual_spend: derived.spend,
    grant_summary: derived.grant_summary,
    action_points: derived.action_points,
  });

  return NextResponse.json({ ok: true });
}
