/**
 * admin_note — short 1–2 page format for addenda, partner replacements,
 * small supplementary grants. No budget annexure; compressed finance section.
 */

import { Document, Packer } from 'docx';
import type { FullAssembly } from './index';
import { docTitle, body, empty, kvTable, labelValueTable, h2, money } from './primitives';
import { headerBlock } from './_base';

function shortFinanceBlock(full: FullAssembly) {
  const gs = full.finance.grant_summary as { grant_number?: number; value_inr?: number; duration_months?: number };
  const acc = full.finance.accounting as { score?: string };
  return kvTable([
    { label: 'Grant #', value: String(gs.grant_number ?? '—') },
    { label: 'Value', value: money(gs.value_inr) },
    { label: 'Duration', value: `${gs.duration_months ?? '—'} months` },
    { label: 'Accounting score', value: acc.score || '—' },
  ]);
}

export async function buildAdminNote(full: FullAssembly): Promise<Buffer> {
  const { partner, judgement, assembly } = full;
  const conditions = judgement.conditions || [];

  const doc = new Document({
    creator: 'Approvals wizard',
    title: `Admin note — ${full.org.name}`,
    sections: [
      {
        properties: {},
        children: [
          docTitle(`Admin note — ${full.org.name}${full.org.city ? `, ${full.org.city}` : ''}`),
          body(
            full.assembly.tier === 'gc' ? 'For: Grants Committee' : 'For: <₹1 Cr approval meeting',
            { muted: true },
          ),
          empty(),
          ...headerBlock(full),
          empty(),
          labelValueTable([
            {
              label: 'Context',
              paragraphs: [
                body(partner.pdd.context?.problem_statement || '—'),
                ...(assembly.rationale_for_delay
                  ? [body(`Note: ${assembly.rationale_for_delay}`, { italic: true, muted: true })]
                  : []),
              ],
            },
            {
              label: 'Proposal',
              paragraphs: [
                body(partner.pdd.goal?.primary || '—'),
                body(
                  `Recommendation: ${judgement.recommendation}${
                    conditions.length ? ` · ${conditions.length} conditions attached` : ''
                  }.`,
                ),
              ],
            },
            {
              label: 'Conditions',
              paragraphs:
                conditions.length > 0
                  ? conditions.map((c) =>
                      body(
                        `• ${c.title}${c.amount_linked ? ' ($-linked)' : ''}: ${c.description}`,
                      ),
                    )
                  : [body('—', { muted: true })],
            },
          ]),
          empty(),
          h2('Finance summary'),
          shortFinanceBlock(full),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
