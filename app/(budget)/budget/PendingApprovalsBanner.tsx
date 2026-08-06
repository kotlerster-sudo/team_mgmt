import Link from 'next/link';
import { auth } from '@/lib/auth';
import { isPartner } from '@/lib/roleGuard';
import { listPendingForPartner, type AssemblyListRow } from '@/lib/approvals/repo';

/**
 * Small server component. Shown at the top of /budget for partner-role users
 * only, when they have one or more approval assemblies invited but not yet
 * submitted. Renders nothing otherwise.
 *
 * Rationale: the partner's home is /budget (per middleware confinement in
 * [[budget_partner_role]]) and they have no way to discover /partner/approvals
 * without the URL. This is the entry point.
 */
export default async function PendingApprovalsBanner() {
  const session = await auth();
  if (!isPartner(session) || !session?.user?.id) return null;

  let pending: AssemblyListRow[] = [];
  try {
    pending = await listPendingForPartner(session.user.id);
  } catch {
    // Review DB unreachable — don't break the /budget page over it.
    return null;
  }
  if (pending.length === 0) return null;

  const href =
    pending.length === 1 ? `/partner/approvals/${pending[0].id}` : '/partner/approvals';
  const orgLabel =
    pending.length === 1
      ? `${pending[0].org_name}${pending[0].org_city ? `, ${pending[0].org_city}` : ''}`
      : null;

  return (
    <Link
      href={href}
      className="block mb-4 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 hover:border-amber-400 hover:bg-amber-100/60 transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
          <span className="text-amber-700 text-lg">📋</span>
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-amber-900">
            {pending.length === 1
              ? `1 approval form to fill${orgLabel ? ` — ${orgLabel}` : ''}`
              : `${pending.length} approval forms to fill`}
          </div>
          <div className="text-xs text-amber-800 mt-0.5">
            Your grants lead has requested structured org data for an upcoming approval. Click to fill.
          </div>
        </div>
        <div className="ml-auto text-sm text-amber-800 shrink-0">→</div>
      </div>
    </Link>
  );
}
