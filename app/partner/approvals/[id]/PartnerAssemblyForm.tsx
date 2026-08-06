'use client';

/**
 * Root of Step 1 — the partner-facing structured form.
 *
 * Owns the shared state, debounced auto-save (every 1500 ms after a change),
 * per-section navigation, DD pre-fill on first load, and the submit flow
 * (Zod-validates the whole PartnerData server-side and locks the step).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import OrgProfileSection from './OrgProfileSection';
import GoverningBodySection from './GoverningBodySection';
import FundingSection from './FundingSection';
import ExpenditureSection from './ExpenditureSection';
import PddSection from './PddSection';
import BeneficiarySection from './BeneficiarySection';

type Section = 'org' | 'board' | 'funding' | 'expenditure' | 'pdd' | 'beneficiary';

const SECTION_LABELS: Record<Section, string> = {
  org: 'Organisation',
  board: 'Governing body',
  funding: 'Funding & income',
  expenditure: 'Expenditure',
  pdd: 'Programme design',
  beneficiary: 'Beneficiary targets',
};

const SECTIONS: Section[] = ['org', 'board', 'funding', 'expenditure', 'pdd', 'beneficiary'];

export type PartnerInitial = {
  org_profile: Record<string, unknown>;
  governing_body: unknown[];
  funding: Record<string, unknown>;
  expenditure: Record<string, unknown>;
  pdd: Record<string, unknown>;
  beneficiary_targets: Record<string, unknown>;
};

export default function PartnerAssemblyForm({
  assemblyId,
  initialData,
  locked,
}: {
  assemblyId: string;
  initialData: PartnerInitial;
  locked: boolean;
}) {
  const router = useRouter();

  const [org, setOrg] = useState<Record<string, unknown>>(initialData.org_profile);
  const [board, setBoard] = useState<unknown[]>(initialData.governing_body);
  const [funding, setFunding] = useState<Record<string, unknown>>(initialData.funding);
  const [expenditure, setExpenditure] = useState<Record<string, unknown>>(initialData.expenditure);
  const [pdd, setPdd] = useState<Record<string, unknown>>(initialData.pdd);
  const [beneficiary, setBeneficiary] = useState<Record<string, unknown>>(
    initialData.beneficiary_targets,
  );

  const [active, setActive] = useState<Section>('org');
  const [savedAt, setSavedAt] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [prefillNotes, setPrefillNotes] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitIssues, setSubmitIssues] = useState<Array<{ path: (string | number)[]; message: string }>>([]);

  const dirtyRef = useRef<Partial<PartnerInitial>>({});
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isEmpty =
    Object.keys(initialData.org_profile).length === 0 &&
    initialData.governing_body.length === 0 &&
    Object.keys(initialData.funding).length === 0;

  // One-shot DD pre-fill when the form loads empty
  useEffect(() => {
    if (locked || !isEmpty) return;
    (async () => {
      const res = await fetch(`/api/approvals/${assemblyId}/partner/prefill`, { method: 'POST' });
      if (!res.ok) return;
      const d = await res.json();
      if (!d.prefilled) return;
      setPrefillNotes(d.notes || []);
      // Reload state from the freshly-populated row
      const r = await fetch(`/api/approvals/${assemblyId}/partner`);
      const rd = await r.json();
      const p = rd.partner;
      if (p) {
        setOrg((p.org_profile as Record<string, unknown>) ?? {});
        setBoard((p.governing_body as unknown[]) ?? []);
        setFunding((p.funding as Record<string, unknown>) ?? {});
        setExpenditure((p.expenditure as Record<string, unknown>) ?? {});
        setPdd((p.pdd as Record<string, unknown>) ?? {});
        setBeneficiary((p.beneficiary_targets as Record<string, unknown>) ?? {});
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flushSave = useCallback(async () => {
    const payload = { ...dirtyRef.current };
    if (Object.keys(payload).length === 0) return;
    dirtyRef.current = {};
    setSaving(true);
    const res = await fetch(`/api/approvals/${assemblyId}/partner`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (res.ok) {
      const d = await res.json();
      setSavedAt(d.saved_at);
    }
  }, [assemblyId]);

  const scheduleSave = useCallback(
    (patch: Partial<PartnerInitial>) => {
      if (locked) return;
      dirtyRef.current = { ...dirtyRef.current, ...patch };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(flushSave, 1500);
    },
    [flushSave, locked],
  );

  // Flush on unmount / tab switch
  useEffect(() => {
    const onHide = () => flushSave();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onHide);
    };
  }, [flushSave]);

  const handleSubmit = async () => {
    setSubmitError(null);
    setSubmitIssues([]);
    await flushSave();
    setSubmitting(true);
    const res = await fetch(`/api/approvals/${assemblyId}/partner/submit`, { method: 'POST' });
    setSubmitting(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setSubmitError(d?.error || `Submit failed (${res.status})`);
      if (Array.isArray(d?.issues)) setSubmitIssues(d.issues);
      return;
    }
    router.refresh();
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
      {/* Sidebar */}
      <aside className="md:sticky md:top-4 self-start">
        <nav className="flex md:flex-col gap-1 bg-white border border-stone-200 rounded-xl p-2">
          {SECTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setActive(s)}
              className={`text-left text-sm px-3 py-2 rounded-lg transition-colors ${
                active === s
                  ? 'bg-sky-50 text-sky-700 font-medium'
                  : 'text-stone-600 hover:bg-stone-50'
              }`}
            >
              {SECTION_LABELS[s]}
            </button>
          ))}
        </nav>

        <div className="mt-3 text-xs text-stone-500 px-2">
          {locked ? (
            <span className="text-emerald-700 font-medium">Submitted — read only.</span>
          ) : saving ? (
            'Saving…'
          ) : savedAt ? (
            `Saved ${new Date(savedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`
          ) : (
            'Not saved yet'
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="min-w-0">
        {prefillNotes.length > 0 && !locked && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
            <div className="font-medium mb-1">Pre-filled from your due-diligence record:</div>
            <ul className="list-disc pl-5 space-y-0.5 text-xs">
              {prefillNotes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}

        {active === 'org' && (
          <OrgProfileSection
            value={org as never}
            onChange={(v) => {
              setOrg(v as never);
              scheduleSave({ org_profile: v as never });
            }}
            disabled={locked}
          />
        )}
        {active === 'board' && (
          <GoverningBodySection
            value={board as never}
            onChange={(v) => {
              setBoard(v as never);
              scheduleSave({ governing_body: v as never });
            }}
            disabled={locked}
          />
        )}
        {active === 'funding' && (
          <FundingSection
            value={funding as never}
            onChange={(v) => {
              setFunding(v as never);
              scheduleSave({ funding: v as never });
            }}
            disabled={locked}
          />
        )}
        {active === 'expenditure' && (
          <ExpenditureSection
            value={expenditure as never}
            onChange={(v) => {
              setExpenditure(v as never);
              scheduleSave({ expenditure: v as never });
            }}
            disabled={locked}
          />
        )}
        {active === 'pdd' && (
          <PddSection
            value={pdd as never}
            onChange={(v) => {
              setPdd(v as never);
              scheduleSave({ pdd: v as never });
            }}
            disabled={locked}
          />
        )}
        {active === 'beneficiary' && (
          <BeneficiarySection
            value={beneficiary as never}
            onChange={(v) => {
              setBeneficiary(v as never);
              scheduleSave({ beneficiary_targets: v as never });
            }}
            disabled={locked}
          />
        )}

        {/* Submit bar */}
        {!locked && (
          <div className="mt-6 bg-white border border-stone-200 rounded-xl p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm text-stone-600">
                Filled everything? Submit locks Step 1 and hands the assembly to the grants team for
                validation.
              </div>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="bg-emerald-600 text-white text-sm px-5 py-2 rounded-lg hover:bg-emerald-700 disabled:bg-stone-300"
              >
                {submitting ? 'Submitting…' : 'Submit Step 1'}
              </button>
            </div>
            {submitError && (
              <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                <div className="font-medium mb-1">{submitError}</div>
                {submitIssues.length > 0 && (
                  <ul className="list-disc pl-5 text-xs mt-1 space-y-0.5">
                    {submitIssues.slice(0, 20).map((i, idx) => (
                      <li key={idx}>
                        <span className="font-mono">{i.path.join('.')}</span>: {i.message}
                      </li>
                    ))}
                    {submitIssues.length > 20 && (
                      <li>… and {submitIssues.length - 20} more.</li>
                    )}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
