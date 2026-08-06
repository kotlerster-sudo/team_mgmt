/**
 * PATCH /api/approvals/[id]/validate/ack
 * Body: { rule_id, note? } — acknowledge a warn/fail
 * Body: { rule_id, action: 'unack' } — retract acknowledgement
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/roleGuard';
import { ackRule, unackRule } from '@/lib/approvals/validation/runner';

const Body = z.object({
  rule_id: z.string().min(1),
  note: z.string().max(200).optional(),
  action: z.enum(['ack', 'unack']).default('ack'),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!isSuperAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }
  try {
    if (parsed.data.action === 'unack') {
      await unackRule(id, parsed.data.rule_id);
    } else {
      await ackRule(id, parsed.data.rule_id, session!.user!.id!, parsed.data.note);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
