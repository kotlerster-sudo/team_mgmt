/**
 * POST /api/approvals/[id]/validate/advance
 * Locks Step 2 and moves current_step → judgement. Requires zero unresolved
 * warn/fail on the latest run. Snapshots version.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/roleGuard';
import { advancePastValidate } from '@/lib/approvals/validation/runner';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!isSuperAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    await advancePastValidate(id, session!.user!.id!);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
