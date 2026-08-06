import type { VersionRow } from '@/lib/approvals/repo';

const TRIGGER_LABEL: Record<string, string> = {
  partner_submit: 'Partner submitted Step 1',
  partner_reopen: 'RP reopened Step 1',
  judgement_submit: 'Judgement submitted',
  finance_confirm: 'Finance annexure confirmed',
  budget_confirm: 'Budget annexure confirmed',
  render: 'Deck rendered',
};

export default function VersionHistory({ versions }: { versions: VersionRow[] }) {
  if (versions.length === 0) {
    return (
      <div className="text-xs text-stone-400">No versions yet.</div>
    );
  }
  return (
    <ul className="space-y-1.5">
      {versions.map((v) => {
        const reason =
          v.trigger === 'partner_reopen'
            ? (v.snapshot_json as { reason?: string } | null)?.reason
            : null;
        return (
          <li key={v.id} className="text-xs text-stone-600 flex items-start gap-2">
            <span className="text-stone-400 font-mono">v{v.version_number}</span>
            <span className="text-stone-800">{TRIGGER_LABEL[v.trigger] || v.trigger}</span>
            <span className="text-stone-400 ml-auto">
              {new Date(v.created_at).toLocaleString('en-IN', {
                day: 'numeric',
                month: 'short',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
            {reason && (
              <span className="block text-stone-500 italic ml-2">— {reason}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
