/**
 * Approval wizard — pre-fill helper.
 *
 * Given an orgId, project the existing org_due_diligence JSONB into a
 * Partial<PartnerData> shape. Best-effort:
 *   - Free-text enums (occupation, education, funder purpose) fuzzy-match
 *     into the canonical enum values, falling back to 'other'.
 *   - Loose FY string keys ("fy2223") normalise to canonical labels ("FY22-23").
 *   - Structured shapes (structured address, related_parties) that don't
 *     exist in DD are left undefined so the partner form asks for them.
 *
 * Never throws. If DD is empty, returns {} — the partner fills everything.
 *
 * Consumers: /api/approvals/[id]/prefill → hydrate Step 1 form state.
 */

import { sql } from '@/lib/review/db';
import type {
  PartnerData,
  BoardMember,
  FunderRow,
  ExpenditureRow,
  OtherIncomeRow,
  FoundationPartnerGrant,
  PddEffect,
} from './schema';

/* ────────────── helpers ────────────── */

const newId = () => Math.random().toString(36).slice(2, 9);

const parseNum = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[,₹\s]/g, '');
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return 0;
};

/** DD stores `fy2223`; wizard stores `FY22-23`. */
const FY_MAP: Record<string, string> = {
  fy2223: 'FY22-23',
  fy2324: 'FY23-24',
  fy2425: 'FY24-25',
  fy2526: 'FY25-26',
  fy2627: 'FY26-27',
  fy2728: 'FY27-28',
  fy2829: 'FY28-29',
};

const fyBucket = (row: Record<string, unknown>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, label] of Object.entries(FY_MAP)) {
    if (k in row) out[label] = parseNum(row[k]);
  }
  return out;
};

/** Loose enum matcher — lowercase, strip punctuation, match prefix. */
const enumMatch = <T extends string>(
  candidates: readonly T[],
  raw: unknown,
  fallback: T,
): T => {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  const norm = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const c of candidates) {
    const cn = c.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (norm === cn || norm.startsWith(cn) || cn.startsWith(norm)) return c;
  }
  return fallback;
};

const parseDate = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  // DD/MM/YYYY → YYYY-MM-DD
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const [, d, mm, y] = m;
    return `${y}-${mm.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
};

/* ────────────── stage projections ────────────── */

function projectOrgProfile(dd: any): Partial<PartnerData['org_profile']> | undefined {
  const p = dd?.org_profile;
  if (!p || typeof p !== 'object') return undefined;
  return {
    legal_name: p.name || undefined,
    // Addresses were free text in DD; leave structured fields for partner to split.
    registration_type: enumMatch(
      ['society', 'trust', 'section_8'] as const,
      p.registrationType,
      'society',
    ),
    registration_number: p.registrationNumber || undefined,
    registration_date: parseDate(p.registrationDate) || undefined,
    pan_number: p.panNumber || undefined,
    pan_date: parseDate(p.panDate) || undefined,
    chief_functionary: {
      name: p.chiefFunctionaryName || '',
      phone: p.chiefFunctionaryContact || '',
    },
    finance_person: {
      name: p.financePersonName || '',
      phone: p.financePersonContact || '',
    },
  };
}

function projectGoverningBody(dd: any): BoardMember[] {
  const raw = dd?.governing_body;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m: any) => m && (m.name || m.role))
    .map((m: any): BoardMember => ({
      id: m.id || newId(),
      name: m.name || '',
      role: enumMatch(
        ['president', 'vice_president', 'secretary', 'joint_secretary', 'treasurer', 'member', 'patron', 'advisor', 'other'] as const,
        m.role,
        'member',
      ),
      address_city: (m.addressContact || '').split(/[,\n]/)[0]?.trim().slice(0, 80) || 'unknown',
      tenure_board_years: Number(m.tenureBoard) || 0,
      tenure_position_years: Number(m.tenurePosition) || 0,
      occupation: enumMatch(
        ['business', 'service', 'retired', 'ngo', 'government', 'education', 'other'] as const,
        m.occupation,
        'other',
      ),
      education: enumMatch(
        ['below_12', 'class_12', 'graduate', 'post_graduate', 'doctorate', 'other'] as const,
        m.education,
        'other',
      ),
      political_exposure: (m.politicalExposure || '').toLowerCase() === 'yes'
        ? 'current'
        : (m.politicalExposure || '').toLowerCase().includes('past') ? 'past' : 'none',
      related_parties: [],
      other_institutions: m.otherInstitutions
        ? [{ institution: String(m.otherInstitutions).slice(0, 160), role: '' }]
        : [],
      flags: [],
    }));
}

function projectFunding(dd: any): Partial<PartnerData['funding']> | undefined {
  const f = dd?.funding_income;
  if (!f || typeof f !== 'object') return undefined;

  const donors: FunderRow[] = Array.isArray(f.sectionA)
    ? f.sectionA
        .filter((r: any) => r && r.funderName)
        .map((r: any): FunderRow => ({
          id: r.id || newId(),
          funder_name: r.funderName,
          funder_type: enumMatch(
            ['foundation', 'csr', 'government', 'fcra_international', 'individual', 'other'] as const,
            r.funderType,
            'other',
          ),
          purpose: enumMatch(
            ['nutrition', 'early_learning', 'wash', 'health', 'livelihoods', 'education', 'advocacy', 'capacity_building', 'unrestricted', 'other'] as const,
            r.purpose,
            'other',
          ),
          start_date: parseDate(r.startDate) || '2000-01-01',
          end_date: parseDate(r.endDate) || '2100-01-01',
          amounts_by_fy: fyBucket(r),
        }))
    : [];

  const other_income: OtherIncomeRow[] = [];
  if (f.sectionB && typeof f.sectionB === 'object') {
    const map: Array<[string, OtherIncomeRow['source']]> = [
      ['bankInterest', 'bank_interest'],
      ['rent', 'rent'],
      ['incidentalIncome', 'incidental'],
      ['individualDonors', 'individual_donors'],
      ['other', 'other'],
    ];
    for (const [ddKey, src] of map) {
      const row = f.sectionB[ddKey];
      if (!row) continue;
      const amounts = fyBucket(row);
      if (Object.values(amounts).some((v) => v > 0)) {
        other_income.push({
          source: src,
          label: src === 'other' ? row.description || undefined : undefined,
          amounts_by_fy: amounts,
        });
      }
    }
  }

  return { donors, other_income };
}

function projectExpenditure(dd: any): Partial<PartnerData['expenditure']> | undefined {
  const e = dd?.expenditure;
  if (!e || typeof e !== 'object') return undefined;

  const DD_TO_CAT: Record<string, ExpenditureRow['category']> = {
    'Salary Expenses': 'salary',
    'Programme Expenses': 'programme',
    'Admin Expenses': 'admin',
    'Capital (Construction/Renovation)': 'capital',
    'One-time Relief Expenditure': 'one_time_relief',
    'Depreciation': 'depreciation',
  };

  const overall: ExpenditureRow[] = e.overall && typeof e.overall === 'object'
    ? Object.entries(e.overall)
        .filter(([label]) => label in DD_TO_CAT)
        .map(([label, row]: [string, any]): ExpenditureRow => ({
          category: DD_TO_CAT[label],
          amounts_by_fy: fyBucket(row),
          current_fy_amount: row.current ? parseNum(row.current) : undefined,
          current_fy_as_of: parseDate(row.currentDate) || undefined,
        }))
    : [];

  const foundation_supported: ExpenditureRow[] = e.foundation && typeof e.foundation === 'object'
    ? Object.entries(e.foundation).map(([, row]: [string, any]): ExpenditureRow => ({
        category: 'programme',
        amounts_by_fy: fyBucket(row),
        current_fy_amount: row.current ? parseNum(row.current) : undefined,
      }))
    : [];

  // Legacy foundationNotes was free text; we can't structurally parse partner
  // grants out of it, so return empty and let partner fill.
  const foundation_partner_grants: FoundationPartnerGrant[] = [];

  return { overall, foundation_supported, foundation_partner_grants };
}

function projectPdd(dd: any): Partial<PartnerData['pdd']> | undefined {
  const p = dd?.pdd;
  if (!p || typeof p !== 'object') return undefined;

  // Legacy PDD was 6 textareas. Best we can do: seed effects & interventions
  // from the existing arrays; leave context/goal for partner to structure.
  const effects: PddEffect[] = Array.isArray(p.effects)
    ? p.effects
        .filter((s: any) => typeof s === 'string' && s.trim())
        .map((s: string): PddEffect => ({
          id: newId(),
          effect: s.slice(0, 200),
          beneficiary_type: 'community',
          count: 0,
          method: 'other',
        }))
    : [];

  const key_interventions = Array.isArray(p.keyInterventions)
    ? p.keyInterventions
        .filter((s: any) => typeof s === 'string' && s.trim())
        .map((s: string) => ({
          intervention: s.slice(0, 200),
          frequency: 'monthly' as const,
          target_count: 0,
          responsible_role: '',
        }))
    : [];

  return { effects, key_interventions };
}

/* ────────────── public API ────────────── */

export type PrefillResult = {
  found: boolean;
  data: Partial<PartnerData>;
  notes: string[]; // human-readable notes about what couldn't be pre-filled
};

export async function prefillFromDD(orgId: string): Promise<PrefillResult> {
  const rows = (await sql`
    SELECT org_profile, governing_body, funding_income, expenditure, pdd
    FROM org_due_diligence
    WHERE org_id = ${orgId}
    LIMIT 1
  `) as any[];

  if (!rows.length) {
    return { found: false, data: {}, notes: ['No due-diligence record for this org.'] };
  }

  const dd = rows[0];
  const notes: string[] = [];

  const org_profile = projectOrgProfile(dd);
  if (org_profile && (!dd.org_profile?.registeredAddress || typeof dd.org_profile.registeredAddress !== 'object')) {
    notes.push('Registered address is free text in DD — partner must split into structured fields.');
  }

  const governing_body = projectGoverningBody(dd);
  if (governing_body.length && governing_body.some((m) => m.address_city === 'unknown')) {
    notes.push('Some board members had free-text address blobs — cities set to "unknown", partner to fix.');
  }

  const funding = projectFunding(dd);
  const expenditure = projectExpenditure(dd);
  const pdd = projectPdd(dd);

  if (pdd) {
    notes.push('PDD context, goal, and history-with-foundation were free text in DD — partner must structure them.');
  }

  const data: Partial<PartnerData> = {};
  if (org_profile) data.org_profile = org_profile as PartnerData['org_profile'];
  if (governing_body.length) data.governing_body = governing_body;
  if (funding) data.funding = funding as PartnerData['funding'];
  if (expenditure) data.expenditure = expenditure as PartnerData['expenditure'];
  if (pdd) data.pdd = pdd as PartnerData['pdd'];

  return { found: true, data, notes };
}
