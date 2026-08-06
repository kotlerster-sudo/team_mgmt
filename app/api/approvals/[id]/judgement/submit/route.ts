/**
 * POST /api/approvals/[id]/judgement/submit
 * Full Zod parse + doc-type gating (renewals require prior_grant_experience).
 * On success: lock, snapshot, move current_step → finance.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/roleGuard';
import { getAssembly, getJudgement, lockJudgement } from '@/lib/approvals/repo';
import { Judgement } from '@/lib/approvals/schema';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!isSuperAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const asm = await getAssembly(id);
  if (!asm) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (asm.judgement_submitted_at) {
    return NextResponse.json({ error: 'Already submitted' }, { status: 409 });
  }

  const j = await getJudgement(id);
  if (!j) return NextResponse.json({ error: 'Fill judgement first.' }, { status: 400 });

  const parsed = Judgement.safeParse({
    honest_read: j.honest_read,
    effect_confidence: j.effect_confidence,
    prior_grant_experience: j.prior_grant_experience ?? undefined,
    risks: j.risks,
    recommendation: j.recommendation,
    conditions: j.conditions,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Judgement fields incomplete or invalid.', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  if (asm.doc_type === 'standard_renewal' && !parsed.data.prior_grant_experience) {
    return NextResponse.json(
      { error: 'Renewals require the prior-grant experience block.' },
      { status: 400 },
    );
  }

  await lockJudgement(id, session!.user!.id!);
  return NextResponse.json({ ok: true });
}
