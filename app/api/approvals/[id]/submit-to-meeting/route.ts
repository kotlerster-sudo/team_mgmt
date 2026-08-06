/**
 * POST /api/approvals/[id]/submit-to-meeting
 * Marks the assembly as 'submitted' once the deck has been rendered.
 * Super-admin only. Doesn't send anything — this is the internal book-keeping
 * hook so /approvals list shows a Submitted pill.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/roleGuard';
import { getAssembly, markSubmittedToMeeting } from '@/lib/approvals/repo';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!isSuperAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const asm = await getAssembly(id);
  if (!asm) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!asm.rendered_at) {
    return NextResponse.json({ error: 'Render the deck first.' }, { status: 400 });
  }

  await markSubmittedToMeeting(id);
  return NextResponse.json({ ok: true });
}
