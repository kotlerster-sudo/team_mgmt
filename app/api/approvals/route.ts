/**
 * Approval assemblies — root REST endpoints.
 *
 * GET  /api/approvals  → list all assemblies (super-admin only)
 * POST /api/approvals  → create a new assembly (Step 0 output)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/roleGuard';
import { DocType, Tier } from '@/lib/approvals/schema';
import { createAssembly, listAssemblies } from '@/lib/approvals/repo';

const CreateBody = z.object({
  org_id: z.string().uuid(),
  doc_type: DocType,
  tier: Tier,
  meeting_date: z.string().date().nullable(),
  presenter: z.string().max(200).default(''),
  visitors_programme: z.array(z.string().max(200)).default([]),
  visitors_finance: z.array(z.string().max(200)).default([]),
  visit_dates_programme: z.array(z.string().date()).default([]),
  visit_dates_finance: z.array(z.string().date()).default([]),
  grm_date: z.string().date().nullable().default(null),
  rationale_for_delay: z.string().max(500).nullable().default(null),
  partner_user_id: z.string().nullable(),
  partner_email: z.string().email().or(z.literal('')).default(''),
});

export async function GET() {
  const session = await auth();
  if (!isSuperAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const rows = await listAssemblies();
  return NextResponse.json({ assemblies: rows });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!isSuperAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = CreateBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 });
  }
  const row = await createAssembly({
    ...parsed.data,
    created_by: session!.user!.id!,
  });
  return NextResponse.json({ assembly: row }, { status: 201 });
}
