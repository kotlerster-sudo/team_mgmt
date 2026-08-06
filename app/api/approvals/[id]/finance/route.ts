/**
 * GET   /api/approvals/[id]/finance → derived annexure + saved RP inputs
 * PATCH /api/approvals/[id]/finance → save accounting_rating and/or grant_summary
 *
 * The derived output is computed on every GET from the current inputs; nothing
 * is frozen until /confirm.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/roleGuard';
import { sql } from '@/lib/review/db';
import {
  getAssembly,
  getPartnerData,
  getJudgement,
  getFinance,
  upsertFinanceInput,
} from '@/lib/approvals/repo';
import { PartnerData, Judgement } from '@/lib/approvals/schema';
import { loadLatestRun } from '@/lib/approvals/validation/runner';
import { deriveFinance, type FinanceRpInput } from '@/lib/approvals/finance/derive';

const PatchBody = z.object({
  accounting_rating: z
    .object({
      system: z.enum(['manual', 'tally', 'erp']),
      monthly_close: z.boolean(),
      audit_report_url: z.string().url().nullable(),
    })
    .partial()
    .optional(),
  grant_summary: z
    .object({
      grant_number: z.number().int().positive(),
      value_inr: z.number().nonnegative(),
      duration_months: z.number().int().positive(),
    })
    .partial()
    .optional(),
});

async function loadDd(orgId: string) {
  const rows = (await sql`
    SELECT org_profile, governing_body, compliance_check, statutory_filings,
           salary_details, funding_income, expenditure, pdd
    FROM org_due_diligence WHERE org_id = ${orgId} LIMIT 1
  `) as Record<string, unknown>[];
  return rows[0] ?? null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!isSuperAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const asm = await getAssembly(id);
  if (!asm) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [partnerRow, judgementRow, financeRow, validation] = await Promise.all([
    getPartnerData(id),
    getJudgement(id),
    getFinance(id),
    loadLatestRun(id),
  ]);
  if (!partnerRow) {
    return NextResponse.json({ error: 'Step 1 empty' }, { status: 400 });
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
    return NextResponse.json({ error: 'Partner data is not schema-valid — reopen Step 1.' }, { status: 400 });
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

  const rpInput: FinanceRpInput | null = financeRow
    ? {
        accounting: (financeRow.accounting_rating as FinanceRpInput['accounting']) ?? {
          system: 'manual',
          monthly_close: false,
          audit_report_url: null,
        },
        grant_summary: (financeRow.grant_summary as FinanceRpInput['grant_summary']) ?? {
          grant_number: 1,
          value_inr: 0,
          duration_months: 12,
        },
      }
    : null;

  const dd = await loadDd(asm.org_id);

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

  return NextResponse.json({
    assembly: asm,
    input: {
      accounting_rating: financeRow?.accounting_rating ?? null,
      grant_summary: financeRow?.grant_summary ?? null,
    },
    derived,
    locked: !!financeRow?.confirmed_at,
    confirmed_at: financeRow?.confirmed_at ?? null,
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!isSuperAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const asm = await getAssembly(id);
  if (!asm) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (asm.finance_confirmed_at) {
    return NextResponse.json({ error: 'Finance already confirmed' }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = PatchBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 });
  }

  await upsertFinanceInput(id, {
    accounting_rating: parsed.data.accounting_rating,
    grant_summary: parsed.data.grant_summary,
  });
  return NextResponse.json({ ok: true, saved_at: new Date().toISOString() });
}
