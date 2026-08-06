/**
 * POST /api/approvals/[id]/budget/confirm
 * Every outlier row must have an ack before we advance. 'adjust_budget'
 * decisions block — the RP must revise the budget and re-select.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/roleGuard';
import { getAssembly, getBudgetSnapshot, freezeBudget } from '@/lib/approvals/repo';

type Outlier = { templateKey: string };

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!isSuperAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const asm = await getAssembly(id);
  if (!asm) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (asm.budget_confirmed_at) {
    return NextResponse.json({ error: 'Already confirmed' }, { status: 409 });
  }

  const row = await getBudgetSnapshot(id);
  if (!row) return NextResponse.json({ error: 'Link a budget first.' }, { status: 400 });

  // Derive outliers from snapshot for the check (they're baked into
  // deviation_snapshot.groups[*].rows with pct).
  const snap = row.deviation_snapshot as {
    groups: Array<{ rows: Array<{ templateKey: string; pct: number | null }> }>;
  } | null;
  const outliers: Outlier[] = [];
  if (snap) {
    for (const g of snap.groups) {
      for (const r of g.rows) {
        if (r.pct != null && Math.abs(r.pct) >= 25) {
          outliers.push({ templateKey: r.templateKey });
        }
      }
    }
  }
  const acks = (row.outlier_ack as Record<string, { decision: 'keeping' | 'adjust_budget' }>) || {};
  const missing = outliers.filter((o) => !acks[o.templateKey]);
  const adjustBlockers = outliers.filter((o) => acks[o.templateKey]?.decision === 'adjust_budget');

  if (missing.length > 0) {
    return NextResponse.json(
      { error: `${missing.length} outlier(s) need acknowledgment before confirming.` },
      { status: 400 },
    );
  }
  if (adjustBlockers.length > 0) {
    return NextResponse.json(
      {
        error: `${adjustBlockers.length} line(s) flagged 'adjust budget' — revise the linked budget and re-select first.`,
      },
      { status: 400 },
    );
  }

  await freezeBudget(id, session!.user!.id!);
  return NextResponse.json({ ok: true });
}
