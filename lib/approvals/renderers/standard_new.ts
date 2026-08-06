/**
 * standard_new — first grant, no renewal annexure.
 * The base grant-note shape: header + main table + Annexure 1 + budget annexure.
 */

import { Document, Packer } from 'docx';
import type { FullAssembly } from './index';
import { docTitle, body, empty } from './primitives';
import { headerBlock, mainTable, financeAnnexure, budgetAnnexure } from './_base';

export async function buildStandardNew(full: FullAssembly): Promise<Buffer> {
  const doc = new Document({
    creator: 'Approvals wizard',
    title: `Grant note — ${full.org.name}`,
    sections: [
      {
        properties: {},
        children: [
          docTitle(`Grant note — ${full.org.name}${full.org.city ? `, ${full.org.city}` : ''}`),
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
          ...budgetAnnexure(full),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
