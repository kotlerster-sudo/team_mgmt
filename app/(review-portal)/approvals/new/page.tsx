'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type Org = { id: string; name: string; city: string };
type PartnerUser = {
  id: string;
  name: string | null;
  email: string;
  granteeLogin?: { grantPartner?: { name: string; city: string } };
};

const DOC_TYPES = [
  { key: 'standard_new', label: 'Standard · New grant', hint: 'First grant to this partner, no renewal annexure' },
  { key: 'standard_renewal', label: 'Standard · Renewal', hint: 'Adds ending-grant comparison annexure' },
  { key: 'infra', label: 'Infra grant', hint: 'One-time equipment/infrastructure grant' },
  { key: 'network_hospital', label: 'Network hospital', hint: 'Hospital programme variant' },
  { key: 'admin_note', label: 'Admin note', hint: 'Short note — addenda, partner replacement, small supplementary' },
] as const;

const INPUT =
  'border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400 w-full';
const LABEL = 'text-xs font-medium text-stone-600';
const HINT = 'text-xs text-stone-400';
const CARD = 'bg-white border border-stone-200 rounded-xl p-5 mb-3';

export default function NewApprovalPage() {
  const router = useRouter();

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [partners, setPartners] = useState<PartnerUser[]>([]);
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgCity, setNewOrgCity] = useState('');

  const [orgId, setOrgId] = useState('');
  const [docType, setDocType] = useState<(typeof DOC_TYPES)[number]['key']>('standard_new');
  const [tier, setTier] = useState<'gc' | 'under_1cr'>('gc');
  const [meetingDate, setMeetingDate] = useState('');
  const [presenter, setPresenter] = useState('');
  const [visitorsProgramme, setVisitorsProgramme] = useState('');
  const [visitorsFinance, setVisitorsFinance] = useState('');
  const [grmDate, setGrmDate] = useState('');
  const [rationaleForDelay, setRationaleForDelay] = useState('');
  const [partnerUserId, setPartnerUserId] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/review/orgs')
      .then((r) => r.json())
      .then((d) => setOrgs(Array.isArray(d) ? d : d.orgs || []));
    fetch('/api/approvals/partner-users')
      .then((r) => r.json())
      .then((d) => setPartners(d.users || []));
  }, []);

  const orgOptions = useMemo(
    () => [...orgs].sort((a, b) => a.name.localeCompare(b.name)),
    [orgs],
  );

  const partnerEmail = useMemo(
    () => partners.find((p) => p.id === partnerUserId)?.email ?? '',
    [partners, partnerUserId],
  );

  async function createOrg() {
    if (!newOrgName.trim()) return;
    const res = await fetch('/api/review/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: newOrgName.trim(), city: newOrgCity.trim() }),
    });
    if (!res.ok) {
      setError('Failed to create org');
      return;
    }
    const d = await res.json();
    setOrgs((prev) => [...prev, d]);
    setOrgId(d.id);
    setCreatingOrg(false);
    setNewOrgName('');
    setNewOrgCity('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!orgId) {
      setError('Pick an organisation.');
      return;
    }
    setSubmitting(true);
    const body = {
      org_id: orgId,
      doc_type: docType,
      tier,
      meeting_date: meetingDate || null,
      presenter: presenter.trim(),
      visitors_programme: visitorsProgramme
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      visitors_finance: visitorsFinance
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      visit_dates_programme: [],
      visit_dates_finance: [],
      grm_date: grmDate || null,
      rationale_for_delay: rationaleForDelay.trim() || null,
      partner_user_id: partnerUserId || null,
      partner_email: partnerEmail,
    };
    const res = await fetch('/api/approvals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d?.error || `Failed (${res.status})`);
      setSubmitting(false);
      return;
    }
    const d = await res.json();
    router.push(`/approvals/${d.assembly.id}`);
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-6">
      <div className="mb-6">
        <Link href="/approvals" className="text-xs text-stone-400 hover:text-stone-700">
          ← Approvals
        </Link>
        <h1 className="text-xl font-semibold text-stone-900 mt-2">New approval</h1>
        <p className="text-sm text-stone-500 mt-1">
          Step 0 — set up the assembly, then invite the partner to fill Step 1.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-3">
        {/* Organisation */}
        <div className={CARD}>
          <div className="flex items-center justify-between mb-3">
            <label className={LABEL}>Organisation</label>
            {!creatingOrg && (
              <button
                type="button"
                onClick={() => setCreatingOrg(true)}
                className="text-xs text-sky-600 hover:text-sky-700"
              >
                + Add new
              </button>
            )}
          </div>

          {!creatingOrg && (
            <select
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              className={INPUT}
              required
            >
              <option value="">— pick an org —</option>
              {orgOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.city ? `, ${o.city}` : ''}
                </option>
              ))}
            </select>
          )}

          {creatingOrg && (
            <div className="space-y-2">
              <input
                autoFocus
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
                placeholder="Org legal name"
                className={INPUT}
              />
              <input
                value={newOrgCity}
                onChange={(e) => setNewOrgCity(e.target.value)}
                placeholder="City (optional)"
                className={INPUT}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={createOrg}
                  className="bg-sky-600 text-white text-sm px-3 py-1.5 rounded-lg hover:bg-sky-700"
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreatingOrg(false);
                    setNewOrgName('');
                    setNewOrgCity('');
                  }}
                  className="text-sm text-stone-500 hover:text-stone-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Doc type */}
        <div className={CARD}>
          <label className={LABEL}>Document type</label>
          <div className="grid gap-2 mt-2">
            {DOC_TYPES.map((t) => (
              <label
                key={t.key}
                className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer ${
                  docType === t.key
                    ? 'border-sky-300 bg-sky-50'
                    : 'border-stone-200 hover:border-stone-300'
                }`}
              >
                <input
                  type="radio"
                  name="docType"
                  checked={docType === t.key}
                  onChange={() => setDocType(t.key)}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-sm text-stone-800">{t.label}</div>
                  <div className={HINT}>{t.hint}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Tier + meeting */}
        <div className={CARD}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Approval tier</label>
              <div className="flex gap-3 mt-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={tier === 'gc'}
                    onChange={() => setTier('gc')}
                  />
                  Grants Committee
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={tier === 'under_1cr'}
                    onChange={() => setTier('under_1cr')}
                  />
                  &lt;₹1 Cr
                </label>
              </div>
            </div>
            <div>
              <label className={LABEL}>Meeting date</label>
              <input
                type="date"
                value={meetingDate}
                onChange={(e) => setMeetingDate(e.target.value)}
                className={INPUT + ' mt-2'}
              />
            </div>
          </div>
        </div>

        {/* People + dates */}
        <div className={CARD}>
          <label className={LABEL}>Presenter</label>
          <input
            value={presenter}
            onChange={(e) => setPresenter(e.target.value)}
            placeholder="Who is presenting to the committee"
            className={INPUT + ' mt-2 mb-3'}
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Programme visitors</label>
              <input
                value={visitorsProgramme}
                onChange={(e) => setVisitorsProgramme(e.target.value)}
                placeholder="Comma-separated"
                className={INPUT + ' mt-2'}
              />
            </div>
            <div>
              <label className={LABEL}>Finance visitors</label>
              <input
                value={visitorsFinance}
                onChange={(e) => setVisitorsFinance(e.target.value)}
                placeholder="Comma-separated"
                className={INPUT + ' mt-2'}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <label className={LABEL}>GRM / debrief date</label>
              <input
                type="date"
                value={grmDate}
                onChange={(e) => setGrmDate(e.target.value)}
                className={INPUT + ' mt-2'}
              />
            </div>
            <div>
              <label className={LABEL}>Rationale for delay (optional)</label>
              <input
                value={rationaleForDelay}
                onChange={(e) => setRationaleForDelay(e.target.value)}
                placeholder="Only if applicable"
                className={INPUT + ' mt-2'}
              />
            </div>
          </div>
        </div>

        {/* Partner invite */}
        <div className={CARD}>
          <label className={LABEL}>Invite partner user</label>
          <p className={HINT + ' mt-1'}>
            The partner will fill Step 1 (structured org data, board, funding, expenditure, PDD, beneficiary
            targets). They must already have a partner login.
          </p>
          <select
            value={partnerUserId}
            onChange={(e) => setPartnerUserId(e.target.value)}
            className={INPUT + ' mt-2'}
          >
            <option value="">— pick a partner user —</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.email}
                {p.granteeLogin?.grantPartner ? ` — ${p.granteeLogin.grantPartner.name}` : ''}
              </option>
            ))}
          </select>
          {partnerUserId && (
            <p className="text-xs text-stone-500 mt-2">
              This partner will see the assembly at{' '}
              <span className="font-mono">/partner/approvals/&lt;id&gt;</span> once created.
            </p>
          )}
        </div>

        {error && <div className="text-sm text-red-600 px-1">{error}</div>}

        <div className="flex items-center justify-between pt-2">
          <Link href="/approvals" className="text-sm text-stone-500 hover:text-stone-800">
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="bg-sky-600 text-white text-sm px-5 py-2 rounded-lg hover:bg-sky-700 disabled:bg-stone-300 transition-colors"
          >
            {submitting ? 'Creating…' : 'Create & invite partner'}
          </button>
        </div>
      </form>
    </div>
  );
}
