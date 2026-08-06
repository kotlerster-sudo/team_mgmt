import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { listAssembliesForPartner } from '@/lib/approvals/repo';
import Link from 'next/link';

export default async function PartnerApprovalsListPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login?callbackUrl=/partner/approvals');

  const rows = await listAssembliesForPartner(session.user.id);
  if (rows.length === 1) redirect(`/partner/approvals/${rows[0].id}`);

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white px-4 py-3">
        <span className="text-sm font-semibold text-stone-800">Your approvals</span>
      </header>
      <div className="max-w-2xl mx-auto px-6 py-6">
        {rows.length === 0 ? (
          <div className="text-center py-20 text-sm text-stone-400">
            No approvals invited yet. Your grants lead will invite you when they start one.
          </div>
        ) : (
          <div className="grid gap-2">
            {rows.map((a) => (
              <Link
                key={a.id}
                href={`/partner/approvals/${a.id}`}
                className="flex items-center justify-between gap-4 px-5 py-4 bg-white border border-stone-200 rounded-xl hover:border-sky-300 transition-colors"
              >
                <div>
                  <div className="font-medium text-stone-900">
                    {a.org_name}
                    {a.org_city ? `, ${a.org_city}` : ''}
                  </div>
                  <div className="text-xs text-stone-500 mt-0.5">
                    {a.doc_type.replace(/_/g, ' ')} · {a.tier === 'gc' ? 'GC' : '<₹1 Cr'}
                    {a.meeting_date ? ` · meeting ${a.meeting_date}` : ''}
                  </div>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    a.partner_submitted_at
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  {a.partner_submitted_at ? 'Submitted' : 'To fill'}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
