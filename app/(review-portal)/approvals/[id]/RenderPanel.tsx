'use client';

/**
 * Step 6 — Render.
 * Downloads the deterministic docx for this assembly. Also downloads
 * the agenda-deck row. "Submit to meeting" flips status to 'submitted'
 * once the deck has been rendered.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const CARD = 'bg-white border border-stone-200 rounded-xl p-5 mb-3';

const DOC_TYPE_LABEL: Record<string, string> = {
  standard_new: 'Standard · New',
  standard_renewal: 'Standard · Renewal',
  infra: 'Infra',
  network_hospital: 'Network Hospital',
  admin_note: 'Admin note',
};

export default function RenderPanel({
  assemblyId,
  docType,
  renderedAt,
  status,
}: {
  assemblyId: string;
  docType: string;
  renderedAt: string | null;
  status: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deckUrl = `/api/approvals/${assemblyId}/render.docx`;
  const agendaUrl = `/api/approvals/${assemblyId}/agenda-row.docx`;

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    const r = await fetch(`/api/approvals/${assemblyId}/submit-to-meeting`, { method: 'POST' });
    setSubmitting(false);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setError(d?.error || `Failed (${r.status})`);
      return;
    }
    router.refresh();
  };

  return (
    <div>
      <p className="text-sm text-stone-600 mb-3">
        All four preceding steps confirmed. Downloads are pure functions of the frozen assembly —
        no LLM in the render path, so the doc is identical on every download.
      </p>

      <div className={CARD}>
        <div className="text-sm font-semibold text-stone-800 mb-2">Downloads</div>
        <div className="flex flex-col gap-2">
          <a
            href={deckUrl}
            className="inline-flex items-center gap-2 text-sm bg-sky-600 text-white px-4 py-2 rounded-lg hover:bg-sky-700 self-start"
          >
            ↓ Download deck (.docx) —{' '}
            <span className="opacity-70">{DOC_TYPE_LABEL[docType] || docType}</span>
          </a>
          <a
            href={agendaUrl}
            className="inline-flex items-center gap-2 text-sm bg-stone-100 text-stone-800 px-4 py-2 rounded-lg hover:bg-stone-200 self-start"
          >
            ↓ Download agenda row (.docx)
          </a>
        </div>
        {renderedAt && (
          <div className="mt-3 text-xs text-emerald-700">
            Deck rendered {new Date(renderedAt).toLocaleString('en-IN')}.
          </div>
        )}
      </div>

      <div className={CARD}>
        <div className="text-sm font-semibold text-stone-800 mb-2">Submit to meeting</div>
        <p className="text-xs text-stone-500 mb-3">
          Marks the assembly as submitted so it shows up on the approvals list with the right
          status. Doesn't send anything to anyone — email/calendar delivery is out of scope for
          this build.
        </p>
        {status === 'submitted' ? (
          <div className="text-xs text-emerald-700 font-medium">Marked as submitted.</div>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !renderedAt}
            className="bg-emerald-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-emerald-700 disabled:bg-stone-300"
          >
            {submitting ? 'Marking…' : 'Mark as submitted'}
          </button>
        )}
        {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
      </div>
    </div>
  );
}
