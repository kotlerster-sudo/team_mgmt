/**
 * GET  /api/approvals/[id]/partner  → hydrate the form (partner + RP)
 * PATCH /api/approvals/[id]/partner → auto-save one or more sections
 *
 * Zod-validated per-section. Any section-shaped body is accepted; missing
 * sections are left alone (COALESCE-style upsert in repo).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authAssembly } from '@/lib/approvals/auth';
import {
  getPartnerData,
  upsertPartnerData,
  type PartnerDataUpsertInput,
} from '@/lib/approvals/repo';
import {
  OrgProfile,
  GoverningBody,
  Funding,
  Expenditure,
  PddStructured,
  BeneficiaryTargets,
} from '@/lib/approvals/schema';

/* PATCH accepts any subset. We use .partial() on every leaf so autosave with
 * still-incomplete data isn't rejected — the final Zod.parse of the full
 * PartnerData happens at submit-time. */
const PatchBody = z.object({
  org_profile: OrgProfile.partial().optional(),
  governing_body: GoverningBody.optional(),
  funding: Funding.partial().optional(),
  expenditure: Expenditure.partial().optional(),
  pdd: PddStructured.partial().optional(),
  beneficiary_targets: BeneficiaryTargets.partial().optional(),
});

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authAssembly(id);
  if (!auth.ok) return auth.response;

  const data = await getPartnerData(id);
  return NextResponse.json({
    assembly: auth.assembly,
    partner: data,
    locked: !!auth.assembly.partner_submitted_at,
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authAssembly(id);
  if (!auth.ok) return auth.response;

  if (auth.assembly.partner_submitted_at) {
    return NextResponse.json({ error: 'Partner step already submitted' }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = PatchBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 });
  }

  const input: PartnerDataUpsertInput = {};
  if (parsed.data.org_profile !== undefined) input.org_profile = parsed.data.org_profile;
  if (parsed.data.governing_body !== undefined) input.governing_body = parsed.data.governing_body;
  if (parsed.data.funding !== undefined) input.funding = parsed.data.funding;
  if (parsed.data.expenditure !== undefined) input.expenditure = parsed.data.expenditure;
  if (parsed.data.pdd !== undefined) input.pdd = parsed.data.pdd;
  if (parsed.data.beneficiary_targets !== undefined) {
    input.beneficiary_targets = parsed.data.beneficiary_targets;
  }

  await upsertPartnerData(id, input);
  return NextResponse.json({ ok: true, saved_at: new Date().toISOString() });
}
