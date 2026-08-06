/**
 * Renderer dispatch + full-assembly loader.
 *
 * `renderApprovalDocx(assemblyId, viewer)` loads the frozen assembly,
 * chooses the right renderer by doc_type, and returns the raw .docx buffer.
 * The full assembly must have Steps 1-4 confirmed (and Step 5 unless
 * doc_type is 'admin_note').
 */

import { Packer } from 'docx';
import { sql } from '@/lib/review/db';
import {
  getAssembly,
  getPartnerData,
  getJudgement,
  getFinance,
  getBudgetSnapshot,
  type AssemblyRow,
} from '../repo';
import { PartnerData, Judgement } from '../schema';
import type { DocType } from '../schema';
import { buildStandardNew } from './standard_new';
import { buildStandardRenewal } from './standard_renewal';
import { buildInfra } from './infra';
import { buildNetworkHospital } from './network_hospital';
import { buildAdminNote } from './admin_note';
import { buildAgendaRow } from './agenda';

export type FullAssembly = {
  assembly: AssemblyRow;
  org: { name: string; city: string };
  partner: import('../schema').PartnerData;
  judgement: import('../schema').Judgement;
  finance: {
    donor_diversity: unknown[];
    statutory: Record<string, unknown>;
    accounting: Record<string, unknown>;
    spend: Record<string, unknown>;
    grant_summary: Record<string, unknown>;
    action_points: unknown[];
  };
  budget: {
    budget_id: string;
    deviation_snapshot: Record<string, unknown>;
    cost_per_beneficiary: Record<string, unknown>;
    multi_year_cash_flow: Record<string, unknown>;
    portfolio_comparables: unknown[];
    per_partner_snapshots: Record<string, unknown> | null;
    outlier_ack: Record<string, unknown>;
  } | null;
};

export async function loadFullAssembly(id: string): Promise<FullAssembly> {
  const assembly = await getAssembly(id);
  if (!assembly) throw new Error('assembly not found');

  const [orgRows, partnerRow, judgementRow, financeRow, budgetRow] = await Promise.all([
    sql`SELECT name, city FROM orgs WHERE id = ${assembly.org_id} LIMIT 1`,
    getPartnerData(id),
    getJudgement(id),
    getFinance(id),
    getBudgetSnapshot(id),
  ]);

  const org = (orgRows as { name: string; city: string }[])[0];
  if (!org) throw new Error('org not found');

  if (!partnerRow) throw new Error('Step 1 (partner) not filled.');
  if (!assembly.partner_submitted_at) throw new Error('Partner step not submitted.');
  if (!judgementRow || !assembly.judgement_submitted_at) throw new Error('Step 3 (judgement) not submitted.');
  if (!financeRow || !financeRow.confirmed_at) throw new Error('Step 4 (finance) not confirmed.');

  const partnerParsed = PartnerData.safeParse({
    org_profile: partnerRow.org_profile,
    governing_body: partnerRow.governing_body,
    funding: partnerRow.funding,
    expenditure: partnerRow.expenditure,
    pdd: partnerRow.pdd,
    beneficiary_targets: partnerRow.beneficiary_targets,
  });
  if (!partnerParsed.success) throw new Error('Partner data no longer matches schema.');

  const judgementParsed = Judgement.safeParse({
    honest_read: judgementRow.honest_read,
    effect_confidence: judgementRow.effect_confidence,
    prior_grant_experience: judgementRow.prior_grant_experience ?? undefined,
    risks: judgementRow.risks,
    recommendation: judgementRow.recommendation,
    conditions: judgementRow.conditions,
  });
  if (!judgementParsed.success) throw new Error('Judgement no longer matches schema.');

  const isAdminNote = assembly.doc_type === 'admin_note';
  if (!isAdminNote && (!budgetRow || !budgetRow.confirmed_at)) {
    throw new Error('Step 5 (budget) not confirmed.');
  }

  return {
    assembly,
    org,
    partner: partnerParsed.data,
    judgement: judgementParsed.data,
    finance: {
      donor_diversity: (financeRow.donor_diversity as unknown[]) || [],
      statutory: (financeRow.statutory_compliance as Record<string, unknown>) || {},
      accounting: (financeRow.accounting_rating as Record<string, unknown>) || {},
      spend: (financeRow.average_annual_spend as Record<string, unknown>) || {},
      grant_summary: (financeRow.grant_summary as Record<string, unknown>) || {},
      action_points: (financeRow.action_points as unknown[]) || [],
    },
    budget: budgetRow
      ? {
          budget_id: budgetRow.budget_id,
          deviation_snapshot:
            (budgetRow.deviation_snapshot as Record<string, unknown>) || {},
          cost_per_beneficiary:
            (budgetRow.cost_per_beneficiary as Record<string, unknown>) || {},
          multi_year_cash_flow:
            (budgetRow.multi_year_cash_flow as Record<string, unknown>) || {},
          portfolio_comparables: (budgetRow.portfolio_comparables as unknown[]) || [],
          per_partner_snapshots:
            (budgetRow.per_partner_snapshots as Record<string, unknown> | null) ?? null,
          outlier_ack: (budgetRow.outlier_ack as Record<string, unknown>) || {},
        }
      : null,
  };
}

const RENDERERS: Record<DocType, (a: FullAssembly) => Promise<Buffer>> = {
  standard_new: buildStandardNew,
  standard_renewal: buildStandardRenewal,
  infra: buildInfra,
  network_hospital: buildNetworkHospital,
  admin_note: buildAdminNote,
};

export async function renderApprovalDocx(assemblyId: string): Promise<{
  buffer: Buffer;
  filename: string;
}> {
  const full = await loadFullAssembly(assemblyId);
  const render = RENDERERS[full.assembly.doc_type as DocType];
  if (!render) throw new Error(`Unknown doc_type: ${full.assembly.doc_type}`);
  const buffer = await render(full);
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  const filename = `${safe(full.assembly.doc_type)}-${safe(full.org.name)}.docx`;
  return { buffer, filename };
}

export async function renderAgendaRow(assemblyId: string): Promise<{
  buffer: Buffer;
  filename: string;
}> {
  const full = await loadFullAssembly(assemblyId);
  const doc = await buildAgendaRow(full);
  const buffer = await Packer.toBuffer(doc);
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  return { buffer, filename: `agenda-row-${safe(full.org.name)}.docx` };
}
