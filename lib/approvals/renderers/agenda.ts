/**
 * agenda — the single-row deck entry for the approval meeting.
 * Returns a Document so the caller can Packer it exactly like the doc-type
 * renderers. Format: one wide table row with org, ask, dependency,
 * recommendation, key conditions.
 */

import { Document, Table, TableRow, TableCell, WidthType, Paragraph, TextRun } from 'docx';
import type { FullAssembly } from './index';
import { FONT, ALL_BORDERS, headerRow, dataRow, money } from './primitives';

export async function buildAgendaRow(full: FullAssembly): Promise<Document> {
  const gs = full.finance.grant_summary as {
    grant_number?: number; value_inr?: number; duration_months?: number; dependency_pct?: number;
  };
  const recLabel = full.judgement.recommendation;
  const conditions = full.judgement.conditions || [];
  const orgLabel = `${full.org.name}${full.org.city ? ', ' + full.org.city : ''}`;
  const ask = `${money(gs.value_inr)} · ${gs.duration_months ?? '—'} mo`;
  const dependency = `${gs.dependency_pct ?? 0}%`;
  const condSummary = conditions.length ? `${conditions.length} condition(s)` : '—';

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: ALL_BORDERS,
    rows: [
      headerRow(['Org', 'Ask', 'Dependency', 'Recommendation', 'Conditions'], [35, 20, 12, 15, 18]),
      dataRow(
        [orgLabel, ask, dependency, recLabel, condSummary],
        [{ bold: true }, { align: 'right' }, { align: 'center' }, { align: 'center' }, {}],
      ),
    ],
  });

  return new Document({
    creator: 'Approvals wizard',
    title: `Agenda row — ${full.org.name}`,
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            spacing: { after: 120 },
            children: [
              new TextRun({
                text: `Agenda row — ${
                  full.assembly.tier === 'gc' ? 'Grants Committee' : '<₹1 Cr approval'
                }${full.assembly.meeting_date ? ` · ${full.assembly.meeting_date}` : ''}`,
                font: FONT,
                size: 20,
                bold: true,
              }),
            ],
          }),
          table,
        ],
      },
    ],
  });
}
