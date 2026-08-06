/**
 * POST /api/approvals/[id]/partner/submit
 *
 * Full PartnerData Zod parse against saved rows; on success:
 *   - snapshot immutable version
 *   - status → partner_submitted, current_step → validate
 *   - partner_submitted_at stamped
 *
 * On failure, returns the Zod issues so the form can point the partner at
 * the offending fields.
 */

import { NextResponse } from 'next/server';
import { authAssembly } from '@/lib/approvals/auth';
import { getPartnerData, lockPartnerStep } from '@/lib/approvals/repo';
import { PartnerData } from '@/lib/approvals/schema';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authAssembly(id);
  if (!auth.ok) return auth.response;

  if (auth.assembly.partner_submitted_at) {
    return NextResponse.json({ error: 'Already submitted' }, { status: 409 });
  }

  const data = await getPartnerData(id);
  if (!data) {
    return NextResponse.json({ error: 'Nothing to submit — fill the form first.' }, { status: 400 });
  }

  const parsed = PartnerData.safeParse({
    org_profile: data.org_profile,
    governing_body: data.governing_body,
    funding: data.funding,
    expenditure: data.expenditure,
    pdd: data.pdd,
    beneficiary_targets: data.beneficiary_targets,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Some required fields are missing or invalid. Fix them and try again.',
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  await lockPartnerStep(id, auth.actorUserId);
  return NextResponse.json({ ok: true, submitted_at: new Date().toISOString() });
}
