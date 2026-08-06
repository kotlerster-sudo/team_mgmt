/**
 * POST /api/approvals/[id]/reopen-partner
 * Admin correction path — unlocks Step 1 for further edits by the partner.
 * Requires super-admin. A short reason is captured on the version snapshot.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/roleGuard';
import { getAssembly, reopenPartnerStep } from '@/lib/approvals/repo';

const Body = z.object({ reason: z.string().min(1).max(300) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!isSuperAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const asm = await getAssembly(id);
  if (!asm) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!asm.partner_submitted_at) {
    return NextResponse.json({ error: 'Step 1 is not submitted; nothing to reopen.' }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Reason required (1–300 chars).' }, { status: 400 });
  }

  await reopenPartnerStep(id, session!.user!.id!, parsed.data.reason);
  return NextResponse.json({ ok: true });
}
