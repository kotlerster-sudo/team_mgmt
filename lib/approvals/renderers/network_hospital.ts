/**
 * network_hospital — hospital-programme variant.
 * Custom header row (adds "hospital name", "beds", "OPD volume" hints extracted
 * from partner.pdd.context.scale_metrics), plus the standard main table +
 * annexures.
 */

import { Document, Packer } from 'docx';
import type { FullAssembly } from './index';
import { docTitle, body, empty, kvTable } from './primitives';
import { headerBlock, mainTable, financeAnnexure, budgetAnnexure } from './_base';

function hospitalKvBlock(full: FullAssembly) {
  const metrics = full.partner.pdd.context?.scale_metrics || [];
  const findMetric = (needle: string) =>
    metrics.find((m) => m.metric.toLowerCase().includes(needle));
  const beds = findMetric('bed');
  const opd = findMetric('opd');
  const ipd = findMetric('ipd');
  const staff = findMetric('doctor') || findMetric('nurse') || findMetric('staff');

  return kvTable([
    ...(beds ? [{ label: 'Beds', value: `${beds.value} ${beds.unit}` }] : []),
    ...(opd ? [{ label: 'OPD volume', value: `${opd.value} ${opd.unit}` }] : []),
    ...(ipd ? [{ label: 'IPD volume', value: `${ipd.value} ${ipd.unit}` }] : []),
    ...(staff ? [{ label: 'Clinical staff', value: `${staff.value} ${staff.unit}` }] : []),
  ]);
}

export async function buildNetworkHospital(full: FullAssembly): Promise<Buffer> {
  const doc = new Document({
    creator: 'Approvals wizard',
    title: `Network hospital note — ${full.org.name}`,
    sections: [
      {
        properties: {},
        children: [
          docTitle(`Network hospital note — ${full.org.name}${full.org.city ? `, ${full.org.city}` : ''}`),
          body(
            full.assembly.tier === 'gc' ? 'For: Grants Committee' : 'For: <₹1 Cr approval meeting',
            { muted: true },
          ),
          empty(),
          ...headerBlock(full),
          empty(),
          hospitalKvBlock(full),
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
