/**
 * PATCH /api/approvals/[id]/budget/outlier-ack
 * Body: { template_key, decision: 'keeping' | 'adjust_budget', note? }
 *
 * Records the RP's decision on a per-line outlier. 'adjust_budget' blocks
 * confirm — the RP is expected to update the underlying budget first.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/roleGuard';
import { upsertOutlierAck } from '@/lib/approvals/repo';

const Body = z.object({
  template_key: z.string().min(1),
  decision: z.enum(['keeping', 'adjust_budget']),
  note: z.string().max(200).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!isSuperAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  try {
    await upsertOutlierAck(id, parsed.data.template_key, {
      decision: parsed.data.decision,
      note: parsed.data.note,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
