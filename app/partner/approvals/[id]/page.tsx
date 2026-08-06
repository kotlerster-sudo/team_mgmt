import { redirect, notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/roleGuard';
import { getAssembly, getAssemblyForPartnerUser, getPartnerData } from '@/lib/approvals/repo';
import PartnerAssemblyForm from './PartnerAssemblyForm';

/**
 * Partner-facing Step 1 entry. Only the invited partner (or a super-admin
 * previewing the form) may load it. Fully server-rendered auth; form state
 * lives in the client component.
 */
export default async function PartnerAssemblyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/login?callbackUrl=/partner/approvals/${id}`);

  const asm = isSuperAdmin(session)
    ? await getAssembly(id)
    : await getAssemblyForPartnerUser(id, session.user.id);
  if (!asm) notFound();

  const partnerData = await getPartnerData(id);
  const locked = !!asm.partner_submitted_at;

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white px-4 py-3 flex items-center gap-3">
        <span className="text-sm font-semibold text-stone-800">Approval form — Step 1</span>
        <span className="text-xs text-stone-400">Assembly {id.slice(0, 8)}</span>
        {locked && (
          <span className="ml-auto text-xs bg-emerald-50 text-emerald-700 px-2 py-1 rounded-full font-medium">
            Submitted
          </span>
        )}
      </header>
      <PartnerAssemblyForm
        assemblyId={id}
        initialData={{
          org_profile: (partnerData?.org_profile as Record<string, unknown>) ?? {},
          governing_body: (partnerData?.governing_body as unknown[]) ?? [],
          funding: (partnerData?.funding as Record<string, unknown>) ?? {},
          expenditure: (partnerData?.expenditure as Record<string, unknown>) ?? {},
          pdd: (partnerData?.pdd as Record<string, unknown>) ?? {},
          beneficiary_targets: (partnerData?.beneficiary_targets as Record<string, unknown>) ?? {},
        }}
        locked={locked}
      />
    </div>
  );
}
