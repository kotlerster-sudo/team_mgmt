/**
 * GET /api/approvals/[id]/budget → link status + saved snapshot + outlier acks.
 * The snapshot is not re-derived on every GET — it's re-derived when a
 * budget is (re-)selected. This keeps the read fast and the snapshot stable.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/roleGuard';
import { getAssembly, getBudgetSnapshot } from '@/lib/approvals/repo';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!isSuperAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const asm = await getAssembly(id);
  if (!asm) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const row = await getBudgetSnapshot(id);
  return NextResponse.json({
    assembly: asm,
    snapshot: row,
    locked: !!row?.confirmed_at,
  });
}
