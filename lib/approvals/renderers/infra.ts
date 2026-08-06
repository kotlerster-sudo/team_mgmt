/**
 * infra — one-time equipment / infrastructure grants.
 * Different main-table shape (Context of situation / Organisation background /
 * Goal / Current proposal / How this grant helps / Our sense of their work),
 * per the prompt spec. Finance + Budget annexures unchanged.
 */

import { Document, Packer } from 'docx';
import type { FullAssembly } from './index';
import { docTitle, body, bullet, empty, labelValueTable, numFmt } from './primitives';
import { headerBlock, financeAnnexure, budgetAnnexure } from './_base';

function infraMainTable(full: FullAssembly) {
  const { partner, judgement, assembly } = full;
  const gs = full.finance.grant_summary as { value_inr?: number; duration_months?: number };

  return labelValueTable([
    {
      label: 'Context of current situation',
      paragraphs: [
        body(partner.pdd.context?.problem_statement || '—'),
        body(
          `Districts: ${(partner.pdd.context?.geography_districts || []).join(', ') || '—'}`,
          { muted: true },
        ),
      ],
    },
    {
      label: 'Organisation background',
      paragraphs: [
        body(
          `Registered as ${partner.org_profile.registration_type} (${partner.org_profile.registration_number}) since ${partner.org_profile.registration_date}. PAN: ${partner.org_profile.pan_number}.`,
        ),
      ],
    },
    {
      label: 'Goal',
      paragraphs: [body(partner.pdd.goal?.primary || '—')],
    },
    {
      label: 'Current proposal',
      paragraphs: [
        body(
          `One-time grant of ${gs.value_inr ? '₹' + gs.value_inr.toLocaleString('en-IN') : '—'}${gs.duration_months ? ` over ${gs.duration_months} months` : ''}.`,
        ),
        body(
          `Reaches ${numFmt(partner.beneficiary_targets.per_year)} beneficiaries per year.`,
        ),
      ],
    },
    {
      label: 'How this grant helps',
      paragraphs: (partner.pdd.key_interventions || []).map((it) =>
        bullet(`${it.intervention} — ${it.frequency}, target ${numFmt(it.target_count)}`),
      ),
    },
    {
      label: 'Our sense of their work',
      paragraphs: [
        body(`Overall RP rating: ${judgement.honest_read.rating ?? '—'}/5.`),
        body(
          `Strengths: ${(judgement.honest_read.strengths || []).join(', ') || '—'}. Concerns: ${(judgement.honest_read.concerns || []).map((c) => c.category).join(', ') || '—'}.`,
        ),
        body(
          `Recommendation: ${judgement.recommendation}${
            judgement.conditions.length ? ` (${judgement.conditions.length} conditions)` : ''
          }.`,
        ),
        ...(assembly.rationale_for_delay
          ? [body(`Delay note: ${assembly.rationale_for_delay}`, { italic: true, muted: true })]
          : []),
      ],
    },
  ]);
}

export async function buildInfra(full: FullAssembly): Promise<Buffer> {
  const doc = new Document({
    creator: 'Approvals wizard',
    title: `Infra grant note — ${full.org.name}`,
    sections: [
      {
        properties: {},
        children: [
          docTitle(`Infra grant note — ${full.org.name}${full.org.city ? `, ${full.org.city}` : ''}`),
          body(
            full.assembly.tier === 'gc' ? 'For: Grants Committee' : 'For: <₹1 Cr approval meeting',
            { muted: true },
          ),
          empty(),
          ...headerBlock(full),
          empty(),
          infraMainTable(full),
          empty(),
          ...financeAnnexure(full),
          empty(),
          ...budgetAnnexure(full),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
