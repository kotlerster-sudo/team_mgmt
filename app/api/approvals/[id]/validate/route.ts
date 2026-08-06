/**
 * GET  /api/approvals/[id]/validate → latest run + counts.
 * Available to super-admin only (the partner never sees validation).
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/roleGuard';
import { loadLatestRun } from '@/lib/approvals/validation/runner';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!isSuperAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const latest = await loadLatestRun(id);
  return NextResponse.json(latest);
}
