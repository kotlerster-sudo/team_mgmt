/**
 * GET   /api/approvals/[id]/judgement  → hydrate
 * PATCH /api/approvals/[id]/judgement  → autosave (any subset)
 *
 * Super-admin only. Full Zod parse happens at /submit.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/roleGuard';
import {
  getAssembly,
  getJudgement,
  getPartnerData,
  upsertJudgement,
  type JudgementUpsertInput,
} from '@/lib/approvals/repo';
import {
  HonestRead,
  EffectConfidence,
  PriorGrantExperience,
  RiskEntry,
  Recommendation,
  Condition,
} from '@/lib/approvals/schema';

const PatchBody = z.object({
  honest_read: HonestRead.partial().optional(),
  effect_confidence: EffectConfidence.optional(),
  prior_grant_experience: PriorGrantExperience.partial().nullable().optional(),
  risks: z.array(RiskEntry).optional(),
  recommendation: Recommendation.nullable().optional(),
  conditions: z.array(Condition).optional(),
});

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!isSuperAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const asm = await getAssembly(id);
  if (!asm) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const [j, p] = await Promise.all([getJudgement(id), getPartnerData(id)]);
  return NextResponse.json({
    assembly: asm,
    judgement: j,
    partner: p,
    locked: !!asm.judgement_submitted_at,
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!isSuperAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const asm = await getAssembly(id);
  if (!asm) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (asm.judgement_submitted_at) {
    return NextResponse.json({ error: 'Judgement already submitted' }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = PatchBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 });
  }

  const input: JudgementUpsertInput = {};
  if (parsed.data.honest_read !== undefined) input.honest_read = parsed.data.honest_read;
  if (parsed.data.effect_confidence !== undefined) input.effect_confidence = parsed.data.effect_confidence;
  if (parsed.data.prior_grant_experience !== undefined) {
    input.prior_grant_experience = parsed.data.prior_grant_experience;
  }
  if (parsed.data.risks !== undefined) input.risks = parsed.data.risks;
  if (parsed.data.recommendation !== undefined) input.recommendation = parsed.data.recommendation;
  if (parsed.data.conditions !== undefined) input.conditions = parsed.data.conditions;

  await upsertJudgement(id, input);
  return NextResponse.json({ ok: true, saved_at: new Date().toISOString() });
}
