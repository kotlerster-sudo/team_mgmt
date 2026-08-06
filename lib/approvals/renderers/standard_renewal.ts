/**
 * standard_renewal — grant renewal. Base shape + Annexure 2 (grant comparison).
 * The "our experience from previous grant" row inside the main table is
 * already handled by _base.mainTable when doc_type === 'standard_renewal'.
 */

import { Document, Packer, Table, WidthType } from 'docx';
import type { FullAssembly } from './index';
import { docTitle, body, empty, h1, h2, headerRow, dataRow, money, numFmt, ALL_BORDERS } from './primitives';
import { headerBlock, mainTable, financeAnnexure, budgetAnnexure } from './_base';

function grantComparisonAnnexure(full: FullAssembly): (Table | ReturnType<typeof body>)[] {
  const out: (Table | ReturnType<typeof body>)[] = [h1('Annexure 2 — Grant comparison') as any];
  const prior = full.partner.pdd.history_with_foundation || [];
  if (prior.length === 0) {
    out.push(body('No prior grants recorded.', { muted: true }));
    return out;
  }

  out.push(h2('Prior grants') as any);
  out.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: ALL_BORDERS,
      rows: [
        headerRow(['Grant #', 'Amount', 'Years', 'Key numeric outcome']),
        ...prior.map((g) =>
          dataRow(
            [String(g.grant_number), money(g.amount), `${g.start_year}–${g.end_year}`, g.key_numeric_outcome || '—'],
            [{ align: 'center' }, { align: 'right' }, { align: 'center' }, {}],
          ),
        ),
      ],
    }),
  );

  const pge = full.judgement.prior_grant_experience;
  if (pge) {
    out.push(h2('RP reflection on ending grant') as any);
    out.push(body(`Overall rating: ${pge.overall_rating}/5.`, { bold: true }));
    out.push(body(`Worked well: ${(pge.worked_well || []).join(', ') || '—'}.`));
    out.push(body(`Didn't work: ${(pge.didnt_work || []).join(', ') || '—'}.`));
    if (pge.key_learning) out.push(body(`Key learning: ${pge.key_learning}`));
  }

  // Budget differences: qualitative for now — compare beneficiary targets +
  // grant value. Deep line-diff between old and new grant is a Phase 4
  // follow-up (needs prior-grant BudgetLine data).
  out.push(h2('Key budget differences') as any);
  out.push(
    body(
      `New grant beneficiary target: ${numFmt(full.partner.beneficiary_targets.per_year)}/year. Prior grants covered a comparable programme window; line-by-line diff pending prior-grant budget linkage.`,
      { muted: true },
    ),
  );

  return out;
}

export async function buildStandardRenewal(full: FullAssembly): Promise<Buffer> {
  const doc = new Document({
    creator: 'Approvals wizard',
    title: `Grant renewal note — ${full.org.name}`,
    sections: [
      {
        properties: {},
        children: [
          docTitle(`Grant renewal note — ${full.org.name}${full.org.city ? `, ${full.org.city}` : ''}`),
          body(
            full.assembly.tier === 'gc' ? 'For: Grants Committee' : 'For: <₹1 Cr approval meeting',
            { muted: true },
          ),
          empty(),
          ...headerBlock(full),
          empty(),
          ...mainTable(full),
          empty(),
          ...financeAnnexure(full),
          empty(),
          ...(grantComparisonAnnexure(full) as never[]),
          empty(),
          ...budgetAnnexure(full),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
