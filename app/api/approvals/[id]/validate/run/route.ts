/**
 * POST /api/approvals/[id]/validate/run
 * Runs the rulebook and persists a fresh run. Super-admin only.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/roleGuard';
import { runValidation } from '@/lib/approvals/validation/runner';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!isSuperAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const summary = await runValidation(id, session!.user!.id!);
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
