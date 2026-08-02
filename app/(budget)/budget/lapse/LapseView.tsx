"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { PartnerLapse } from "@/lib/budget/lapse";

const money = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`;

const pct = (n: number) => `${n.toFixed(1)}%`;

// A partner returning a fifth of a grant unspent is not a compliance problem —
// it is a sizing problem in the next one.
const HIGH = 20;
const WATCH = 10;

const toneFor = (p: number) =>
  p >= HIGH ? "text-red-600" : p >= WATCH ? "text-amber-600" : "text-stone-600";

export default function LapseView({
  records, domainLabels, units,
}: {
  records: PartnerLapse[];
  domainLabels: Record<string, string>;
  units: { id: string; name: string }[];
}) {
  const tabs = ["All", ...units.map((u) => u.name)];
  const [city, setCity] = useState("All");
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(
    () => (city === "All" ? records : records.filter((r) => r.city === city)),
    [records, city],
  );

  const totals = useMemo(() => {
    const budgeted = filtered.reduce((s, r) => s + r.budgeted, 0);
    const lapsed = filtered.reduce((s, r) => s + r.lapsed, 0);
    const carried = filtered.reduce((s, r) => s + r.carriedForward, 0);
    return { budgeted, lapsed, carried, pct: budgeted > 0 ? (lapsed / budgeted) * 100 : 0 };
  }, [filtered]);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/budget/dashboard" className="text-xs text-stone-400 hover:text-stone-600">← Dashboard</Link>
        <h1 className="text-xl font-semibold text-stone-900">Lapse track record</h1>
        <p className="text-sm text-stone-500">
          Closed grant years only. Money that was budgeted, never spent, and never carried forward — so it lapsed.
        </p>
      </div>

      <div className="flex items-center gap-1 border-b border-stone-200 overflow-x-auto">
        {tabs.map((c) => (
          <button key={c} onClick={() => setCity(c)}
            className={`whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 -mb-px ${city === c ? "border-sky-600 text-sky-700" : "border-transparent text-stone-500 hover:text-stone-800"}`}>
            {c}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Budgeted (closed years)", value: money(totals.budgeted), tone: "text-stone-900" },
          { label: "Lapsed", value: money(totals.lapsed), tone: toneFor(totals.pct) },
          { label: "Lapse rate", value: pct(totals.pct), tone: toneFor(totals.pct) },
          { label: "Carried forward", value: money(totals.carried), tone: "text-stone-900" },
        ].map((t) => (
          <div key={t.label} className="rounded-xl border border-stone-200 bg-white p-4">
            <div className="text-xs text-stone-400">{t.label}</div>
            <div className={`mt-1 text-lg font-semibold ${t.tone}`}>{t.value}</div>
          </div>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-stone-200 bg-white p-5 text-sm text-stone-400">
          No grant year has closed yet — every year still has a report outstanding.
        </p>
      ) : (
        <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
          {filtered.map((r) => (
            <li key={r.partnerId}>
              <button onClick={() => setOpenId(openId === r.partnerId ? null : r.partnerId)}
                className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-stone-50">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-stone-900">{r.partnerName}</div>
                  <div className="truncate text-xs text-stone-400">
                    {r.city} · {r.budgetCount} grant{r.budgetCount === 1 ? "" : "s"} · {r.years.length} closed year{r.years.length === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="flex items-center gap-4 whitespace-nowrap text-xs">
                  <span className="text-stone-400">{money(r.budgeted)} budgeted</span>
                  <span className={toneFor(r.lapsePct)}>{money(r.lapsed)} lapsed</span>
                  <span className={`font-medium ${toneFor(r.lapsePct)}`}>{pct(r.lapsePct)}</span>
                </div>
              </button>

              {openId === r.partnerId && (
                <div className="grid gap-6 border-t border-stone-100 bg-stone-50/60 px-4 py-4 sm:grid-cols-2">
                  <div>
                    <div className="mb-2 text-xs font-semibold text-stone-500">By grant year</div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-stone-400">
                          <th className="text-left font-medium py-1">Year</th>
                          <th className="text-right font-medium">Budgeted</th>
                          <th className="text-right font-medium">Spent</th>
                          <th className="text-right font-medium">Carried</th>
                          <th className="text-right font-medium">Lapsed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.years.map((y) => {
                          const p = y.budgeted > 0 ? (y.lapsed / y.budgeted) * 100 : 0;
                          return (
                            <tr key={y.grantYear} className="border-t border-stone-100">
                              <td className="py-1 text-stone-600">Y{y.grantYear}</td>
                              <td className="text-right text-stone-500">{money(y.budgeted)}</td>
                              <td className="text-right text-stone-500">{money(y.actual)}</td>
                              <td className="text-right text-stone-400">{y.carriedForward > 0 ? money(y.carriedForward) : "—"}</td>
                              <td className={`text-right ${toneFor(p)}`}>{money(y.lapsed)} <span className="text-stone-300">({pct(p)})</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div>
                    <div className="mb-2 text-xs font-semibold text-stone-500">Where it lapsed</div>
                    <ul className="space-y-1 text-xs">
                      {r.byDomain.filter((d) => d.lapsed > 0).map((d) => {
                        const p = d.budgeted > 0 ? (d.lapsed / d.budgeted) * 100 : 0;
                        return (
                          <li key={d.domain ?? "cross"} className="flex items-baseline justify-between gap-3">
                            <span className="text-stone-600">{d.domain ? (domainLabels[d.domain] ?? d.domain) : "Cross-cutting"}</span>
                            <span className={toneFor(p)}>{money(d.lapsed)} <span className="text-stone-300">({pct(p)})</span></span>
                          </li>
                        );
                      })}
                      {r.byDomain.every((d) => d.lapsed === 0) && <li className="text-stone-400">Nothing lapsed.</li>}
                    </ul>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
