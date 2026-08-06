'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ReopenPartnerButton({ assemblyId }: { assemblyId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!reason.trim()) {
      setError('Reason is required.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/approvals/${assemblyId}/reopen-partner`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: reason.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d?.error || `Failed (${res.status})`);
      return;
    }
    setOpen(false);
    setReason('');
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-amber-700 hover:text-amber-800 underline"
      >
        Reopen partner step
      </button>
    );
  }

  return (
    <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
      <div className="text-xs font-medium text-amber-900 mb-2">Reason for reopening</div>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={300}
        placeholder="Short explanation — audited on the version log"
        className="border border-stone-200 rounded-lg px-3 py-1.5 text-sm w-full focus:outline-none focus:border-amber-400"
      />
      {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="bg-amber-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-amber-700 disabled:bg-stone-300"
        >
          {busy ? 'Reopening…' : 'Reopen'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setReason('');
            setError(null);
          }}
          className="text-xs text-stone-500 hover:text-stone-800"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
