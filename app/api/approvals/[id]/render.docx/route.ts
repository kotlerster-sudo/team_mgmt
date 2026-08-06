/**
 * GET /api/approvals/[id]/render.docx
 * Streams the deterministic docx for this assembly. Marks the assembly
 * as rendered on success. Super-admin only.
 */

import { auth } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/roleGuard';
import { renderApprovalDocx } from '@/lib/approvals/renderers';
import { markRendered } from '@/lib/approvals/repo';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!isSuperAdmin(session)) return new Response('Forbidden', { status: 403 });

  try {
    const { buffer, filename } = await renderApprovalDocx(id);
    await markRendered(id, session!.user!.id!);
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    return new Response((e as Error).message, { status: 400 });
  }
}
