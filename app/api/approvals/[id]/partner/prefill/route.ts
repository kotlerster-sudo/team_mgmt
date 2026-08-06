/**
 * POST /api/approvals/[id]/partner/prefill
 *
 * One-shot: seed partner_data from org_due_diligence via prefillFromDD.
 * Non-destructive if the row already has data — the partner form calls this
 * only when partner_data is empty (fresh assembly).
 */

import { NextResponse } from 'next/server';
import { authAssembly } from '@/lib/approvals/auth';
import { getPartnerData, upsertPartnerData } from '@/lib/approvals/repo';
import { prefillFromDD } from '@/lib/approvals/prefillFromDD';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authAssembly(id);
  if (!auth.ok) return auth.response;

  if (auth.assembly.partner_submitted_at) {
    return NextResponse.json({ error: 'Already submitted' }, { status: 409 });
  }

  const existing = await getPartnerData(id);
  const isEmpty =
    !existing ||
    (
      Object.keys((existing.org_profile as object) || {}).length === 0 &&
      Array.isArray(existing.governing_body) &&
      (existing.governing_body as unknown[]).length === 0
    );
  if (!isEmpty) {
    return NextResponse.json({ error: 'Partner data already present — skipped prefill.' }, { status: 409 });
  }

  const result = await prefillFromDD(auth.assembly.org_id);
  if (!result.found) {
    return NextResponse.json({ ok: true, prefilled: false, notes: result.notes });
  }

  await upsertPartnerData(id, {
    org_profile: result.data.org_profile,
    governing_body: result.data.governing_body,
    funding: result.data.funding,
    expenditure: result.data.expenditure,
    pdd: result.data.pdd,
  });
  return NextResponse.json({ ok: true, prefilled: true, notes: result.notes });
}
