/**
 * POST /api/approvals/[id]/budget/select
 * Body: { budget_id, domain? }
 *
 * Runs deriveBudget against the picked Budget + assembly's beneficiary_targets
 * and persists the full snapshot into assessment_budget_snapshot.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/roleGuard';
import prisma from '@/lib/prisma';
import { getAssembly, getPartnerData, upsertBudgetSnapshot } from '@/lib/approvals/repo';
import { PartnerData } from '@/lib/approvals/schema';
import { deriveBudget } from '@/lib/approvals/budget/derive';

const Body = z.object({
  budget_id: z.string().min(1),
  domain: z.string().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!isSuperAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const asm = await getAssembly(id);
  if (!asm) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (asm.budget_confirmed_at) {
    return NextResponse.json({ error: 'Budget already confirmed' }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  const partnerRow = await getPartnerData(id);
  if (!partnerRow) return NextResponse.json({ error: 'Fill Step 1 first' }, { status: 400 });
  const partnerParsed = PartnerData.safeParse({
    org_profile: partnerRow.org_profile,
    governing_body: partnerRow.governing_body,
    funding: partnerRow.funding,
    expenditure: partnerRow.expenditure,
    pdd: partnerRow.pdd,
    beneficiary_targets: partnerRow.beneficiary_targets,
  });
  if (!partnerParsed.success) {
    return NextResponse.json({ error: 'Partner data is not schema-valid.' }, { status: 400 });
  }

  const budget = await prisma.budget.findUnique({
    where: { id: parsed.data.budget_id },
    select: { domains: true },
  });
  if (!budget) return NextResponse.json({ error: 'Budget not found' }, { status: 404 });
  const domain = parsed.data.domain || budget.domains[0];
  if (!domain) {
    return NextResponse.json({ error: 'Budget has no domain to key against.' }, { status: 400 });
  }

  try {
    const derived = await deriveBudget({
      budgetId: parsed.data.budget_id,
      domain,
      viewerUserId: session!.user!.id!,
      beneficiariesPerYear: partnerParsed.data.beneficiary_targets.per_year,
    });
    await upsertBudgetSnapshot(id, parsed.data.budget_id, {
      deviation_snapshot: derived.snapshot,
      cost_per_beneficiary: derived.cost_per_beneficiary,
      multi_year_cash_flow: derived.multi_year_cash_flow,
      portfolio_comparables: derived.portfolio_comparables,
      per_partner_snapshots: derived.per_partner_snapshots,
    });
    return NextResponse.json({ ok: true, derived });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
