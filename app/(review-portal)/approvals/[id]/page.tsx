import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAssembly, getPartnerData, listVersions } from '@/lib/approvals/repo';
import { sql } from '@/lib/review/db';
import PartnerDataView from './PartnerDataView';
import VersionHistory from './VersionHistory';
import ReopenPartnerButton from './ReopenPartnerButton';
import ValidatePanel from './ValidatePanel';
import JudgementPanel from './JudgementPanel';
import FinancePanel from './FinancePanel';
import BudgetPanel from './BudgetPanel';

const STEP_LABELS: Record<string, string> = {
  setup: 'Setup',
  partner: 'Partner data',
  validate: 'Validate',
  judgement: 'Judgement',
  finance: 'Finance',
  budget: 'Budget',
  render: 'Generate deck',
};

const STEP_ORDER = ['setup', 'partner', 'validate', 'judgement', 'finance', 'budget', 'render'] as const;

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  partner_pending: 'Partner filling',
  partner_submitted: 'Partner submitted',
  validating: 'Validating',
  judging: 'Judgement',
  finance_confirmed: 'Finance confirmed',
  budget_confirmed: 'Budget confirmed',
  rendered: 'Rendered',
  submitted: 'Submitted',
  approved: 'Approved',
  declined: 'Declined',
};

const DOC_TYPE_LABEL: Record<string, string> = {
  standard_new: 'Standard · New',
  standard_renewal: 'Standard · Renewal',
  infra: 'Infra',
  network_hospital: 'Network Hospital',
  admin_note: 'Admin note',
};

export default async function AssemblyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const asm = await getAssembly(id);
  if (!asm) notFound();

  const [orgRowsRaw, partnerData, versions] = await Promise.all([
    sql`SELECT name, city FROM orgs WHERE id = ${asm.org_id} LIMIT 1`,
    getPartnerData(id),
    listVersions(id),
  ]);
  const org = (orgRowsRaw as { name: string; city: string }[])[0];

  const activeIdx = STEP_ORDER.indexOf(asm.current_step as (typeof STEP_ORDER)[number]);

  return (
    <div className="max-w-4xl mx-auto px-6 py-6">
      <Link href="/approvals" className="text-xs text-stone-400 hover:text-stone-700">
        ← Approvals
      </Link>

      <div className="mt-3 mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">
            {org?.name}
            {org?.city ? `, ${org.city}` : ''}
          </h1>
          <p className="text-sm text-stone-500 mt-1">
            {DOC_TYPE_LABEL[asm.doc_type] || asm.doc_type} · {asm.tier === 'gc' ? 'Grants Committee' : '<₹1 Cr'}
            {asm.meeting_date ? ` · meeting ${asm.meeting_date}` : ''}
            {asm.presenter ? ` · presenter ${asm.presenter}` : ''}
          </p>
          <p className="text-xs text-stone-400 mt-1">
            Assembly {asm.id.slice(0, 8)} · created {new Date(asm.created_at).toLocaleDateString('en-IN')}
          </p>
        </div>
        <span
          className={`text-xs px-2 py-1 rounded-full font-medium ${
            asm.partner_submitted_at
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-amber-100 text-amber-700'
          }`}
        >
          {STATUS_LABEL[asm.status] || asm.status}
        </span>
      </div>

      {/* Progress rail */}
      <div className="bg-white border border-stone-200 rounded-xl p-4 mb-4">
        <div className="flex items-center gap-2 overflow-x-auto">
          {STEP_ORDER.map((s, i) => {
            const done = activeIdx > i;
            const active = asm.current_step === s;
            return (
              <div key={s} className="flex items-center gap-2 shrink-0">
                <span
                  className={`text-xs px-2 py-1 rounded-full ${
                    active
                      ? 'bg-sky-100 text-sky-700 font-medium'
                      : done
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-stone-50 text-stone-400'
                  }`}
                >
                  {i}. {STEP_LABELS[s]}
                </span>
                {i < STEP_ORDER.length - 1 && <span className="text-stone-300">→</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Current-step focus */}
      <div className="bg-white border border-stone-200 rounded-xl p-5 mb-4">
        <div className="text-sm font-semibold text-stone-800 mb-2">
          Current: {STEP_LABELS[asm.current_step] || asm.current_step}
        </div>
        {asm.current_step === 'partner' && (
          <div className="text-sm text-stone-600 space-y-1">
            {asm.partner_user_id ? (
              <div>
                Invited partner user{' '}
                {asm.partner_email && <span className="font-mono text-xs">({asm.partner_email})</span>}. They
                fill Step 1 at <span className="font-mono text-xs">/partner/approvals/{asm.id}</span>.
              </div>
            ) : (
              <div className="text-amber-700">No partner user attached yet.</div>
            )}
          </div>
        )}
        {asm.current_step === 'validate' && asm.partner_submitted_at && (
          <div className="space-y-3">
            <div className="text-xs text-stone-500">
              Partner submitted Step 1 on{' '}
              {new Date(asm.partner_submitted_at).toLocaleString('en-IN')}.
            </div>
            <ValidatePanel assemblyId={asm.id} />
            <div>
              <ReopenPartnerButton assemblyId={asm.id} />
            </div>
          </div>
        )}
        {asm.current_step === 'judgement' && (
          <JudgementPanel assemblyId={asm.id} docType={asm.doc_type} />
        )}
        {asm.current_step === 'finance' && (
          <FinancePanel assemblyId={asm.id} />
        )}
        {asm.current_step === 'budget' && (
          <BudgetPanel assemblyId={asm.id} />
        )}
        {asm.current_step === 'render' && (
          <div className="text-sm text-stone-400">
            Render step (Phase 4) — deterministic docx templates per doc type. Ships next.
          </div>
        )}
      </div>

      {/* Partner data — if submitted */}
      {asm.partner_submitted_at && partnerData && (
        <div className="mb-4">
          <PartnerDataView data={partnerData} />
        </div>
      )}

      {/* Version history */}
      <div className="bg-white border border-stone-200 rounded-xl p-4">
        <div className="text-sm font-semibold text-stone-800 mb-2">Version history</div>
        <VersionHistory versions={versions} />
      </div>
    </div>
  );
}
