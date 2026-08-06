'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Assembly = {
  id: string;
  org_name: string;
  org_city: string;
  doc_type: string;
  tier: string;
  meeting_date: string | null;
  status: string;
  current_step: string;
  presenter: string;
  partner_email: string;
  created_at: string;
  updated_at: string;
};

const DOC_TYPE_LABEL: Record<string, string> = {
  standard_new: 'Standard · New',
  standard_renewal: 'Standard · Renewal',
  infra: 'Infra',
  network_hospital: 'Network Hospital',
  admin_note: 'Admin note',
};

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

const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-stone-100 text-stone-600',
  partner_pending: 'bg-sky-100 text-sky-700',
  partner_submitted: 'bg-indigo-100 text-indigo-700',
  validating: 'bg-amber-100 text-amber-700',
  judging: 'bg-violet-100 text-violet-700',
  finance_confirmed: 'bg-teal-100 text-teal-700',
  budget_confirmed: 'bg-emerald-100 text-emerald-700',
  rendered: 'bg-emerald-100 text-emerald-700',
  submitted: 'bg-emerald-100 text-emerald-700',
  approved: 'bg-emerald-100 text-emerald-700',
  declined: 'bg-red-100 text-red-700',
};

export default function ApprovalsListPage() {
  const [rows, setRows] = useState<Assembly[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/approvals')
      .then((r) => r.json())
      .then((d) => {
        setRows(d.assemblies || []);
        setLoading(false);
      });
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-6 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Approvals</h1>
          <p className="text-sm text-stone-500 mt-0.5">
            Partner data → validate → judgement → finance → budget → deck. Structured, deterministic.
          </p>
        </div>
        <Link
          href="/approvals/new"
          className="bg-sky-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-sky-700 transition-colors"
        >
          + New approval
        </Link>
      </div>

      {loading && <div className="text-center py-20 text-stone-400 text-sm">Loading…</div>}

      {!loading && rows.length === 0 && (
        <div className="text-center py-20">
          <p className="text-stone-400 text-sm">No approvals yet.</p>
          <Link href="/approvals/new" className="mt-3 inline-block text-sky-600 text-sm hover:underline">
            Start the first one →
          </Link>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="grid gap-2">
          {rows.map((a) => (
            <Link
              key={a.id}
              href={`/approvals/${a.id}`}
              className="flex items-center justify-between gap-4 px-5 py-4 bg-white border border-stone-200 rounded-xl hover:border-sky-300 hover:shadow-sm transition-all"
            >
              <div className="min-w-0">
                <div className="font-medium text-stone-900 truncate">
                  {a.org_name}
                  {a.org_city ? `, ${a.org_city}` : ''}
                </div>
                <div className="text-xs text-stone-500 mt-0.5">
                  {DOC_TYPE_LABEL[a.doc_type] || a.doc_type} ·{' '}
                  {a.tier === 'gc' ? 'GC' : '<₹1 Cr'}
                  {a.meeting_date ? ` · ${a.meeting_date}` : ''}
                  {a.presenter ? ` · ${a.presenter}` : ''}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    STATUS_COLOR[a.status] || 'bg-stone-100 text-stone-600'
                  }`}
                >
                  {STATUS_LABEL[a.status] || a.status}
                </span>
                <div className="text-xs text-stone-400">
                  {new Date(a.updated_at).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
