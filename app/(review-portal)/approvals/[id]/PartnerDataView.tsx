import type { PartnerDataRow } from '@/lib/approvals/repo';

const FY_LABELS = ['FY22-23', 'FY23-24', 'FY24-25', 'FY25-26', 'FY26-27', 'FY27-28', 'FY28-29'];

const CARD = 'bg-white border border-stone-200 rounded-xl p-5 mb-3';
const KEY = 'text-xs text-stone-500';
const VAL = 'text-sm text-stone-800';
const SECTION_TITLE = 'text-sm font-semibold text-stone-900 mb-3';

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1">
      <span className={KEY}>{k}</span>
      <span className={VAL}>{v || <span className="text-stone-300">—</span>}</span>
    </div>
  );
}

function money(n: number | undefined): string {
  if (!n) return '';
  return `₹${new Intl.NumberFormat('en-IN').format(n)}`;
}

/* Server component. Renders the submitted partner_data as a compact
 * read-only summary — the RP scans this before running Step 2 validation. */
export default function PartnerDataView({ data }: { data: PartnerDataRow }) {
  const org = data.org_profile as Record<string, any> | null;
  const board = (data.governing_body as any[]) || [];
  const funding = data.funding as Record<string, any> | null;
  const exp = data.expenditure as Record<string, any> | null;
  const pdd = data.pdd as Record<string, any> | null;
  const ben = data.beneficiary_targets as Record<string, any> | null;

  return (
    <>
      {/* Org profile */}
      <div className={CARD}>
        <div className={SECTION_TITLE}>Organisation</div>
        <div className="grid grid-cols-2 gap-3">
          <KV k="Legal name" v={org?.legal_name} />
          <KV
            k="Registration"
            v={
              org?.registration_type
                ? `${org.registration_type} · ${org.registration_number || ''} (${org.registration_date || ''})`
                : null
            }
          />
          <KV k="PAN" v={org?.pan_number ? `${org.pan_number} (${org.pan_date || ''})` : null} />
          <KV
            k="Registered address"
            v={
              org?.registered_address
                ? [
                    org.registered_address.line1,
                    org.registered_address.line2,
                    `${org.registered_address.city || ''}, ${org.registered_address.state || ''} — ${org.registered_address.pincode || ''}`,
                  ]
                    .filter(Boolean)
                    .join(', ')
                : null
            }
          />
          <KV
            k="Chief functionary"
            v={
              org?.chief_functionary
                ? `${org.chief_functionary.name || ''} · ${org.chief_functionary.phone || ''}`
                : null
            }
          />
          <KV
            k="Finance person"
            v={
              org?.finance_person
                ? `${org.finance_person.name || ''} · ${org.finance_person.phone || ''}`
                : null
            }
          />
        </div>
      </div>

      {/* Governing body */}
      <div className={CARD}>
        <div className={SECTION_TITLE}>
          Governing body <span className="text-stone-400 font-normal">· {board.length} members</span>
        </div>
        {board.length === 0 ? (
          <div className="text-sm text-stone-400">No members captured.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-stone-500">
                  <th className="text-left py-1 pr-3">Name</th>
                  <th className="text-left py-1 pr-3">Role</th>
                  <th className="text-left py-1 pr-3">City</th>
                  <th className="text-left py-1 pr-3">Tenure (b/p)</th>
                  <th className="text-left py-1 pr-3">Occupation</th>
                  <th className="text-left py-1 pr-3">Education</th>
                  <th className="text-left py-1 pr-3">Political</th>
                </tr>
              </thead>
              <tbody>
                {board.map((m: any, i: number) => (
                  <tr key={m.id || i} className="border-t border-stone-100">
                    <td className="py-1.5 pr-3 text-stone-800 font-medium">{m.name}</td>
                    <td className="py-1.5 pr-3">{m.role}</td>
                    <td className="py-1.5 pr-3">{m.address_city}</td>
                    <td className="py-1.5 pr-3">
                      {m.tenure_board_years} / {m.tenure_position_years}
                    </td>
                    <td className="py-1.5 pr-3">{m.occupation}</td>
                    <td className="py-1.5 pr-3">{m.education}</td>
                    <td className="py-1.5 pr-3">{m.political_exposure}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Funding */}
      <div className={CARD}>
        <div className={SECTION_TITLE}>Funding & income</div>
        {(!funding?.donors || funding.donors.length === 0) ? (
          <div className="text-sm text-stone-400">No funders captured.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-stone-500">
                  <th className="text-left py-1 pr-3">Funder</th>
                  <th className="text-left py-1 pr-3">Type</th>
                  <th className="text-left py-1 pr-3">Purpose</th>
                  {FY_LABELS.map((fy) => (
                    <th key={fy} className="text-right py-1 pr-3">
                      {fy}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(funding.donors as any[]).map((d, i) => (
                  <tr key={d.id || i} className="border-t border-stone-100">
                    <td className="py-1.5 pr-3 text-stone-800 font-medium">{d.funder_name}</td>
                    <td className="py-1.5 pr-3">{d.funder_type}</td>
                    <td className="py-1.5 pr-3">{d.purpose}</td>
                    {FY_LABELS.map((fy) => (
                      <td key={fy} className="py-1.5 pr-3 text-right tabular-nums">
                        {money(d.amounts_by_fy?.[fy])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Expenditure */}
      <div className={CARD}>
        <div className={SECTION_TITLE}>Expenditure</div>
        {(!exp?.overall || exp.overall.length === 0) ? (
          <div className="text-sm text-stone-400">No expenditure captured.</div>
        ) : (
          <>
            <div className="text-xs text-stone-500 mb-1">Overall</div>
            <table className="w-full text-xs mb-3">
              <thead>
                <tr className="text-stone-500">
                  <th className="text-left py-1 pr-3">Category</th>
                  {FY_LABELS.map((fy) => (
                    <th key={fy} className="text-right py-1 pr-3">
                      {fy}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(exp.overall as any[]).map((r, i) => (
                  <tr key={i} className="border-t border-stone-100">
                    <td className="py-1.5 pr-3">{r.category}</td>
                    {FY_LABELS.map((fy) => (
                      <td key={fy} className="py-1.5 pr-3 text-right tabular-nums">
                        {money(r.amounts_by_fy?.[fy])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {exp.foundation_supported && exp.foundation_supported.length > 0 && (
              <>
                <div className="text-xs text-stone-500 mb-1">Foundation-supported</div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-stone-500">
                      <th className="text-left py-1 pr-3">Category</th>
                      {FY_LABELS.map((fy) => (
                        <th key={fy} className="text-right py-1 pr-3">
                          {fy}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(exp.foundation_supported as any[]).map((r, i) => (
                      <tr key={i} className="border-t border-stone-100">
                        <td className="py-1.5 pr-3">{r.category}</td>
                        {FY_LABELS.map((fy) => (
                          <td key={fy} className="py-1.5 pr-3 text-right tabular-nums">
                            {money(r.amounts_by_fy?.[fy])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
      </div>

      {/* PDD */}
      <div className={CARD}>
        <div className={SECTION_TITLE}>Programme design</div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <KV k="Districts" v={pdd?.context?.geography_districts?.join(', ')} />
          <KV
            k="Vulnerable populations"
            v={(pdd?.context?.vulnerable_populations || []).join(', ')}
          />
        </div>
        <KV k="Problem statement" v={pdd?.context?.problem_statement} />
        <div className="mt-3">
          <KV k="Primary goal" v={pdd?.goal?.primary} />
        </div>
        {pdd?.goal?.measurable_outcomes && pdd.goal.measurable_outcomes.length > 0 && (
          <div className="mt-3">
            <div className={KEY}>Measurable outcomes</div>
            <ul className="list-disc pl-5 text-sm text-stone-800 mt-1 space-y-0.5">
              {(pdd.goal.measurable_outcomes as any[]).map((o, i) => (
                <li key={i}>
                  {o.outcome} — {o.target_count} {o.beneficiary_type}
                </li>
              ))}
            </ul>
          </div>
        )}
        {pdd?.effects && pdd.effects.length > 0 && (
          <div className="mt-3">
            <div className={KEY}>Effects</div>
            <ul className="list-disc pl-5 text-sm text-stone-800 mt-1 space-y-0.5">
              {(pdd.effects as any[]).map((e, i) => (
                <li key={i}>
                  {e.effect} — {e.count} {e.beneficiary_type} ({e.method})
                </li>
              ))}
            </ul>
          </div>
        )}
        {pdd?.key_interventions && pdd.key_interventions.length > 0 && (
          <div className="mt-3">
            <div className={KEY}>Key interventions</div>
            <ul className="list-disc pl-5 text-sm text-stone-800 mt-1 space-y-0.5">
              {(pdd.key_interventions as any[]).map((it, i) => (
                <li key={i}>
                  {it.intervention} · {it.frequency} · {it.target_count} · {it.responsible_role}
                </li>
              ))}
            </ul>
          </div>
        )}
        {pdd?.people_involved && pdd.people_involved.length > 0 && (
          <div className="mt-3">
            <div className={KEY}>People involved</div>
            <ul className="list-disc pl-5 text-sm text-stone-800 mt-1 space-y-0.5">
              {(pdd.people_involved as any[]).map((p, i) => (
                <li key={i}>
                  {p.category} · {p.role} · {p.count} @ {p.fte_pct}% FTE
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Beneficiary */}
      <div className={CARD}>
        <div className={SECTION_TITLE}>Beneficiary targets</div>
        <div className="grid grid-cols-2 gap-3">
          <KV k="Per year" v={ben?.per_year ? new Intl.NumberFormat('en-IN').format(ben.per_year) : null} />
          <KV
            k="Lifetime"
            v={ben?.lifetime ? new Intl.NumberFormat('en-IN').format(ben.lifetime) : null}
          />
        </div>
        {ben?.notes && <div className="mt-3"><KV k="Counting method" v={ben.notes} /></div>}
      </div>
    </>
  );
}
