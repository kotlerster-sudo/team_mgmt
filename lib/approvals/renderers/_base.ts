/**
 * Shared building blocks reused by 4 out of 5 doc-type renderers.
 * Kept in one place so a change to (say) the finance annexure layout
 * lands everywhere at once.
 */

import { Paragraph } from 'docx';
import type { FullAssembly } from './index';
import {
  h1,
  h2,
  h3,
  body,
  bullet,
  empty,
  kvTable,
  labelValueTable,
  headerRow,
  dataRow,
  money,
  numFmt,
  pct,
  ALL_BORDERS,
} from './primitives';
import { Table, TableRow, TableCell, WidthType } from 'docx';

/* ─────────── HEADER BLOCK ─────────── */

export function headerBlock(full: FullAssembly): (Paragraph | Table)[] {
  const { assembly, org, partner } = full;
  const priorGrantsLine = (partner.pdd.history_with_foundation || [])
    .map((g) => `Grant ${g.grant_number}: ${money(g.amount)} (${g.start_year}–${g.end_year})`)
    .join(' · ');

  const rows = [
    { label: 'Organisation', value: `${org.name}${org.city ? `, ${org.city}` : ''}` },
    {
      label: 'Theme / geography',
      value: (partner.pdd.context?.geography_districts || []).join(', ') || '—',
    },
    { label: 'Presented by', value: assembly.presenter || '—' },
    {
      label: 'Visited by (programme)',
      value:
        (assembly.visitors_programme || []).join(', ') +
        (assembly.visit_dates_programme?.length
          ? ` — dates: ${assembly.visit_dates_programme.join(', ')}`
          : ''),
    },
    {
      label: 'Visited by (finance)',
      value:
        (assembly.visitors_finance || []).join(', ') +
        (assembly.visit_dates_finance?.length
          ? ` — dates: ${assembly.visit_dates_finance.join(', ')}`
          : ''),
    },
    { label: 'GRM / debrief date', value: assembly.grm_date || '—' },
    { label: 'Meeting date', value: assembly.meeting_date || '—' },
    ...(assembly.rationale_for_delay
      ? [{ label: 'Rationale for delay', value: assembly.rationale_for_delay }]
      : []),
    ...(priorGrantsLine ? [{ label: 'Grant history', value: priorGrantsLine }] : []),
  ];

  return [kvTable(rows)];
}

/* ─────────── MAIN TABLE (standard grant note shape) ─────────── */

export function mainTable(full: FullAssembly): (Paragraph | Table)[] {
  const { partner, judgement, assembly } = full;
  const gs = full.finance.grant_summary as {
    grant_number?: number; value_inr?: number; duration_months?: number; dependency_pct?: number;
  };

  const executive = [
    body(
      `${assembly.doc_type === 'standard_renewal' ? 'Renewal' : 'Fresh'} grant of ${money(
        gs.value_inr,
      )} over ${gs.duration_months || 12} months, ${gs.dependency_pct ?? 0}% of average annual spend.`,
    ),
    body(
      `Primary goal: ${partner.pdd.goal?.primary || '—'}`,
    ),
    body(
      `Recommendation: ${judgement.recommendation}${
        judgement.conditions.length ? ` (${judgement.conditions.length} conditions)` : ''
      }.`,
    ),
  ];

  const contextParas = [
    body(partner.pdd.context?.problem_statement || '—'),
    body(
      `Districts: ${(partner.pdd.context?.geography_districts || []).join(', ') || '—'}. Vulnerable populations: ${(partner.pdd.context?.vulnerable_populations || []).join(', ') || '—'}.`,
      { muted: true },
    ),
  ];

  const goalParas: Paragraph[] = [body(partner.pdd.goal?.primary || '—')];
  for (const o of partner.pdd.goal?.measurable_outcomes || []) {
    goalParas.push(bullet(`${o.outcome} — ${numFmt(o.target_count)} ${o.beneficiary_type}`));
  }

  const effectsParas: Paragraph[] = [];
  const conf = (judgement.effect_confidence as Record<string, { confidence: string; note?: string }>) || {};
  for (const e of partner.pdd.effects || []) {
    const c = conf[e.id];
    effectsParas.push(
      bullet(
        `${e.effect} — ${numFmt(e.count)} ${e.beneficiary_type} (${e.method})${
          c ? ` · RP confidence: ${c.confidence}${c.note ? ` — ${c.note}` : ''}` : ''
        }`,
      ),
    );
  }

  const interventionParas = (partner.pdd.key_interventions || []).map((it) =>
    bullet(
      `${it.intervention} — ${it.frequency}, target ${numFmt(it.target_count)}, owned by ${it.responsible_role}`,
    ),
  );

  const programmeStaff = (partner.pdd.people_involved || []).filter(
    (p) => p.category === 'programme' || p.category === 'other',
  );
  const adminStaff = (partner.pdd.people_involved || []).filter((p) => p.category === 'admin');

  const peopleTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: ALL_BORDERS,
    rows: [
      headerRow(['Programme staff', 'Admin staff'], [50, 50]),
      new TableRow({
        children: [
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            children:
              programmeStaff.length > 0
                ? programmeStaff.map((p) => bullet(`${p.role} — ${p.count} @ ${p.fte_pct}% FTE`))
                : [body('—', { muted: true })],
          }),
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            children:
              adminStaff.length > 0
                ? adminStaff.map((p) => bullet(`${p.role} — ${p.count} @ ${p.fte_pct}% FTE`))
                : [body('—', { muted: true })],
          }),
        ],
      }),
    ],
  });

  const referencesParas: Paragraph[] = [];
  const donors = partner.funding.donors || [];
  if (donors.length > 0) {
    for (const d of donors.slice(0, 5)) {
      referencesParas.push(bullet(`${d.funder_name} (${d.funder_type})`));
    }
  } else {
    referencesParas.push(body('—', { muted: true }));
  }

  const rows: Array<{ label: string; paragraphs: Paragraph[] }> = [
    { label: '1. Executive Summary', paragraphs: executive },
  ];
  if (assembly.doc_type === 'standard_renewal') {
    const workedWell = judgement.prior_grant_experience?.worked_well || [];
    const didnt = judgement.prior_grant_experience?.didnt_work || [];
    rows.push({
      label: '2. Our experience from the previous grant',
      paragraphs: [
        body(
          `Overall rating: ${judgement.prior_grant_experience?.overall_rating ?? '—'}/5.`,
        ),
        body(`Worked well: ${workedWell.length ? workedWell.join(', ') : '—'}.`),
        body(`Didn't work: ${didnt.length ? didnt.join(', ') : '—'}.`),
        ...(judgement.prior_grant_experience?.key_learning
          ? [body(`Key learning: ${judgement.prior_grant_experience.key_learning}`)]
          : []),
      ],
    });
  }
  rows.push(
    { label: '3. Context', paragraphs: contextParas },
    { label: '4. Goal', paragraphs: goalParas },
    { label: '5. Effects', paragraphs: effectsParas.length ? effectsParas : [body('—', { muted: true })] },
    {
      label: '6. Key interventions',
      paragraphs: interventionParas.length ? interventionParas : [body('—', { muted: true })],
    },
    { label: '7. People involved', paragraphs: [] }, // rendered below the table as its own block
    { label: '8. References', paragraphs: referencesParas },
  );

  return [labelValueTable(rows), empty(), peopleTable];
}

/* ─────────── ANNEXURE 1 — FINANCE ─────────── */

export function financeAnnexure(full: FullAssembly): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [h1('Annexure 1 — Financial Assessment')];

  const donors = full.finance.donor_diversity as Array<{
    funder_name: string; funder_type: string; origin: string;
    amount_current: number; amount_prior_2y: number;
  }>;
  out.push(h2('Donor diversity'));
  if (donors.length === 0) {
    out.push(body('No funders recorded.', { muted: true }));
  } else {
    out.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: ALL_BORDERS,
        rows: [
          headerRow(['Funder', 'Type', 'D/I', 'Current FY', 'Prior 2y'], [40, 20, 10, 15, 15]),
          ...donors.map((d) =>
            dataRow(
              [d.funder_name, d.funder_type, d.origin === 'international' ? 'I' : 'D', money(d.amount_current), money(d.amount_prior_2y)],
              [{}, {}, { align: 'center' }, { align: 'right' }, { align: 'right' }],
            ),
          ),
        ],
      }),
    );
  }

  const st = full.finance.statutory as {
    fcra_valid_until: string | null; reg_12a_present: boolean; reg_80g_present: boolean;
    latest_itr_fy: string | null; latest_itr_filing_date: string | null;
  };
  out.push(h2('Statutory compliance'));
  out.push(
    kvTable([
      { label: '12A registration', value: st.reg_12a_present ? 'Present' : 'Not on file' },
      { label: '80G registration', value: st.reg_80g_present ? 'Present' : 'Not on file' },
      { label: 'FCRA valid until', value: st.fcra_valid_until || '—' },
      {
        label: 'Latest ITR',
        value:
          (st.latest_itr_fy || '—') +
          (st.latest_itr_filing_date ? ` · filed ${st.latest_itr_filing_date}` : ''),
      },
    ]),
  );

  const acc = full.finance.accounting as { system: string; monthly_close: boolean; score: string };
  out.push(h2('Accounting system'));
  out.push(
    kvTable([
      { label: 'System', value: acc.system },
      { label: 'Monthly close performed', value: acc.monthly_close ? 'Yes' : 'No' },
      { label: 'Score', value: acc.score },
    ]),
  );

  const spend = full.finance.spend as {
    by_fy_overall: Record<string, number>;
    by_fy_foundation_share: Record<string, number>;
    average_last_3fy: number;
  };
  const fys = Object.keys(spend.by_fy_overall).sort();
  out.push(h2('Average annual spend'));
  out.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: ALL_BORDERS,
      rows: [
        headerRow(['FY', 'Overall', 'Foundation share']),
        ...fys.map((fy) =>
          dataRow(
            [fy, money(spend.by_fy_overall[fy]), money(spend.by_fy_foundation_share[fy] || 0)],
            [{}, { align: 'right' }, { align: 'right' }],
          ),
        ),
      ],
    }),
  );
  out.push(body(`Average over last 3 FYs: ${money(spend.average_last_3fy)}`, { bold: true }));

  const gs = full.finance.grant_summary as {
    grant_number: number; value_inr: number; duration_months: number; dependency_pct: number;
  };
  out.push(h2('Grant summary'));
  out.push(
    kvTable([
      { label: 'Grant number', value: String(gs.grant_number) },
      { label: 'Value', value: money(gs.value_inr) },
      { label: 'Duration', value: `${gs.duration_months} months` },
      { label: 'Dependency %', value: `${gs.dependency_pct}%` },
    ]),
  );

  const aps = full.finance.action_points as Array<{ source: string; title: string; detail: string }>;
  out.push(h2('Remarks & action points'));
  if (aps.length === 0) {
    out.push(body('None.', { muted: true }));
  } else {
    for (const ap of aps) {
      out.push(body(ap.title, { bold: true }));
      out.push(body(ap.detail, { muted: true }));
      out.push(empty());
    }
  }

  return out;
}

/* ─────────── BUDGET ANNEXURE ─────────── */

export function budgetAnnexure(full: FullAssembly): (Paragraph | Table)[] {
  if (!full.budget) {
    return [h1('Budget annexure'), body('No budget linked.', { muted: true })];
  }
  const b = full.budget;
  const dev = b.deviation_snapshot as {
    budgetName?: string; city?: string; domain?: string; unitLabel?: string; unitCount?: number;
    groups?: Array<{
      label: string; subtotalProposed: number; subtotalStandard: number;
      subtotalDelta: number; subtotalPct: number | null;
      rows: Array<{ description: string; perUnitProposed: number; perUnitStandard: number; perUnitDelta: number; pct: number | null }>;
    }>;
  };
  const cpb = b.cost_per_beneficiary as {
    y1_total: number; beneficiaries_per_year: number; cost_per_beneficiary: number;
  };
  const cash = b.multi_year_cash_flow as { years?: Array<{ year_label: string; amount: number }> };

  const out: (Paragraph | Table)[] = [
    h1('Budget annexure'),
    body(
      `${dev.budgetName || ''} · ${dev.city || ''} · ${dev.domain || ''} · ${dev.unitCount || 0} ${dev.unitLabel || 'unit'}`,
      { muted: true },
    ),
  ];

  out.push(h2('Cost per beneficiary'));
  out.push(
    kvTable([
      { label: 'Year-1 total', value: money(cpb.y1_total) },
      { label: 'Beneficiaries per year', value: numFmt(cpb.beneficiaries_per_year) },
      { label: 'Cost per beneficiary', value: money(cpb.cost_per_beneficiary) },
    ]),
  );

  out.push(h2('Multi-year cash flow'));
  const years = cash.years || [];
  out.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: ALL_BORDERS,
      rows: [
        headerRow(years.map((y) => y.year_label).concat(['Total'])),
        dataRow(
          [...years.map((y) => money(y.amount)), money(years.reduce((a, y) => a + y.amount, 0))],
          [
            ...years.map(() => ({ align: 'right' as const })),
            { align: 'right' as const, bold: true },
          ],
        ),
      ],
    }),
  );

  out.push(h2('Deviation vs standard cost registry'));
  const groups = dev.groups || [];
  if (groups.length === 0) {
    out.push(body('No deviation lines.', { muted: true }));
  } else {
    for (const g of groups) {
      out.push(h3(g.label));
      out.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: ALL_BORDERS,
          rows: [
            headerRow(['Item', 'Proposed', 'Standard', 'Delta', '%'], [40, 15, 15, 15, 15]),
            ...g.rows.map((r) =>
              dataRow(
                [r.description, money(r.perUnitProposed), money(r.perUnitStandard), money(r.perUnitDelta), pct(r.pct)],
                [{}, { align: 'right' }, { align: 'right' }, { align: 'right' }, { align: 'right' }],
              ),
            ),
            dataRow(
              ['Subtotal', money(g.subtotalProposed), money(g.subtotalStandard), money(g.subtotalDelta), pct(g.subtotalPct)],
              [{ bold: true }, { align: 'right', bold: true }, { align: 'right', bold: true }, { align: 'right', bold: true }, { align: 'right', bold: true }],
            ),
          ],
        }),
      );
      out.push(empty());
    }
  }

  const acks = b.outlier_ack as Record<string, { decision: string; note?: string }>;
  const ackEntries = Object.entries(acks || {});
  if (ackEntries.length > 0) {
    out.push(h2('Outlier acknowledgments'));
    for (const [key, ack] of ackEntries) {
      out.push(body(`${key}: ${ack.decision}${ack.note ? ` — ${ack.note}` : ''}`, { muted: true }));
    }
  }

  return out;
}
