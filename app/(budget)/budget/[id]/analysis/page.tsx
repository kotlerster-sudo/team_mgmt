import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import type { BudgetSection } from "@/app/generated/prisma/client";
import Link from "next/link";

const SECTION_LABELS: Record<BudgetSection, string> = {
  salary: "Salary & Honorarium", capex: "CAPEX",
  travel: "Travel", programme: "Programme",
  admin_salary: "Admin – Salaries", admin_other: "Admin – Other",
  additional: "Additional",
};

const INR = (n: number, dec = 0) =>
  n === 0 ? "–" : `₹${n.toLocaleString("en-IN", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;

const L = (n: number) => `₹${(n / 100000).toFixed(2)}L`;

const AVG_HH_PER_SETTLEMENT = 150;

type BenefUnit = { label: string; count: number; description: string };

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const budget = await prisma.budget.findUnique({
    where: { id },
    include: { inputs: true, lines: { orderBy: { position: "asc" } } },
  });

  if (!budget || budget.partnerId !== session!.user!.id!) notFound();
  if (!budget.inputs) return <div className="text-stone-400 p-8">No inputs recorded for this budget.</div>;

  const domainConfigs = await prisma.budgetDomainConfig.findMany({
    where: { city: budget.city },
    select: { key: true, label: true, beneficiaryLabel: true, beneficiaryVar: true, beneficiaryMult: true },
  });
  const domainLabelMap = Object.fromEntries(domainConfigs.map(d => [d.key, d.label]));
  const domainConfigMap = Object.fromEntries(domainConfigs.map(d => [d.key, d]));

  // Merged inputs: typed fields (backward compat) + extraInputs (new budgets, any domain)
  const raw = budget.inputs;
  const inp: Record<string, number> = {
    nSettlements: raw.nSettlements, nClusters: raw.nClusters,
    nCLCs: raw.nCLCs, clcRentPerMonth: raw.clcRentPerMonth,
    nYRCs: raw.nYRCs, yrcRentPerMonth: raw.yrcRentPerMonth,
    nElderlyCentres: raw.nElderlyCentres, nElderly: raw.nElderly,
    elderlyCentreRentPerMonth: raw.elderlyCentreRentPerMonth,
    cosPerCluster: raw.cosPerCluster, rcRentPerMonth: raw.rcRentPerMonth,
    nCreches: raw.nCreches, crecheRentPerMonth: raw.crecheRentPerMonth,
    ...(raw.extraInputs as Record<string, number>),
  };

  const lines = budget.lines;
  // Year-bands derived from horizonMonths (legacy single-year budgets read 12 / 36 here).
  const horizonMonths = budget.horizonMonths ?? budget.years * 12;
  type BandKey = 1 | 2 | 3 | 4 | 5;
  type Band = { k: BandKey; factor: number; label: string };
  const computeBands = (h: number): Band[] => {
    const full = Math.floor(h / 12); const tail = h - full * 12;
    const out: Band[] = [];
    for (let k = 1 as BandKey; k <= 5; k = (k + 1) as BandKey) {
      if (k <= full) out.push({ k, factor: 1, label: `Year ${k}` });
      else if (k === full + 1 && tail > 0) out.push({ k, factor: tail / 12, label: `Year ${k} (${tail}mo)` });
    }
    return out;
  };
  const bands = computeBands(horizonMonths);
  const horizonDisplay = horizonMonths % 12 === 0
    ? `${horizonMonths / 12}-Year`
    : `${horizonMonths}-Month`;

  const yKey = (k: BandKey) => `y${k}Total` as const;

  const domainTotal = (domain: string | null, k: BandKey) =>
    lines.filter(l => l.domain === domain).reduce((s, l) => s + l[yKey(k)], 0);

  const sectionTotal = (section: BudgetSection, k: BandKey) =>
    lines.filter(l => l.section === section).reduce((s, l) => s + l[yKey(k)], 0);

  const grandTotal = (k: BandKey) =>
    lines.reduce((s, l) => s + l[yKey(k)], 0);

  const gt1 = grandTotal(1);
  const horizonTotal = bands.reduce((s, b) => s + grandTotal(b.k), 0);

  // Dynamic beneficiary units from domain configs
  const benefUnits = budget.domains
    .map(domainKey => {
      const config = domainConfigMap[domainKey];
      if (!config?.beneficiaryVar) return null;
      const rawCount = inp[config.beneficiaryVar] ?? 0;
      const count = Math.round(rawCount * config.beneficiaryMult);
      if (count === 0) return null;
      return {
        domain: domainKey,
        label: config.beneficiaryLabel ?? config.label,
        count,
        description: `${rawCount} ${config.beneficiaryVar} × ${config.beneficiaryMult}`,
        total: domainTotal(domainKey, 1),
      };
    })
    .filter(Boolean) as (BenefUnit & { domain: string; total: number })[];

  const totalBeneficiaries = benefUnits.reduce((s, b) => s + b.count, 0);

  const sections: BudgetSection[] = ["salary", "capex", "travel", "programme", "admin_salary", "admin_other"];
  const headData = sections.map(s => ({
    section: s,
    y1: sectionTotal(s, 1),
    pct: gt1 > 0 ? sectionTotal(s, 1) / gt1 * 100 : 0,
  })).filter(h => h.y1 > 0);

  const salaryTotal   = sectionTotal("salary", 1);
  const adminTotal    = sectionTotal("admin_salary", 1) + sectionTotal("admin_other", 1);
  const programmeTotal = gt1 - salaryTotal - adminTotal - sectionTotal("capex", 1) - sectionTotal("travel", 1);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-6">
        <Link href={`/budget/${budget.id}`} className="text-xs text-stone-400 hover:text-stone-700">← Back to budget</Link>
        <span className="hidden sm:inline text-stone-300">|</span>
        <h1 className="text-lg font-semibold text-stone-900">{budget.name} — Cost Analysis</h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {bands.map(b => {
          const total = grandTotal(b.k);
          const sub = b.k === 1
            ? `${INR(total / Math.round(12 * b.factor))} /month`
            : `${gt1 > 0 ? `${total > gt1 ? "+" : ""}${((total / gt1 - 1) * 100).toFixed(1)}% vs Y1` : "—"}`;
          return <StatCard key={b.k} label={`${b.label} Total`} value={L(total)} sub={sub} />;
        })}
        {bands.length > 1 && (
          <StatCard label={`${horizonDisplay} Total`} value={L(horizonTotal)} sub="cumulative" highlight />
        )}
        <StatCard label="Total beneficiaries" value={totalBeneficiaries.toLocaleString("en-IN")} sub="across all domains" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        <section>
          <h2 className="text-sm font-semibold text-stone-700 mb-3">Per-Beneficiary Cost (Year 1)</h2>
          <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-stone-100 bg-stone-50 text-xs text-stone-500">
                  <th className="text-left px-4 py-2.5">Domain</th>
                  <th className="text-right px-3 py-2.5">Beneficiaries</th>
                  <th className="text-right px-3 py-2.5">Domain total</th>
                  <th className="text-right px-3 py-2.5 font-medium">Cost / person / yr</th>
                </tr>
              </thead>
              <tbody>
                {benefUnits.map(b => (
                  <tr key={b.domain} className="border-b border-stone-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-stone-800">{domainLabelMap[b.domain] ?? b.domain}</div>
                      <div className="text-xs text-stone-400">{b.description}</div>
                    </td>
                    <td className="text-right px-3 py-3 text-stone-600">{b.count.toLocaleString("en-IN")}</td>
                    <td className="text-right px-3 py-3 text-stone-600">{L(b.total)}</td>
                    <td className="text-right px-3 py-3 font-semibold text-sky-700">
                      {b.count > 0 ? INR(b.total / b.count) : "–"}
                    </td>
                  </tr>
                ))}
                {inp.nSettlements > 0 && (
                  <tr className="border-b border-stone-50 bg-stone-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-stone-700">Overall (all domains)</div>
                      <div className="text-xs text-stone-400">{inp.nSettlements} settlements · {totalBeneficiaries.toLocaleString("en-IN")} beneficiaries</div>
                    </td>
                    <td className="text-right px-3 py-3 text-stone-500">{totalBeneficiaries.toLocaleString("en-IN")}</td>
                    <td className="text-right px-3 py-3 text-stone-500">{L(gt1)}</td>
                    <td className="text-right px-3 py-3 font-semibold text-stone-800">
                      {totalBeneficiaries > 0 ? INR(gt1 / totalBeneficiaries) : "–"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-stone-700 mb-3">Budget Head Breakdown</h2>
          <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="border-b border-stone-100 bg-stone-50 text-xs text-stone-500">
                  <th className="text-left px-4 py-2.5">Head</th>
                  <th className="text-right px-3 py-2.5">Year 1</th>
                  <th className="text-right px-3 py-2.5">% of total</th>
                </tr>
              </thead>
              <tbody>
                {headData.map(h => (
                  <tr key={h.section} className="border-b border-stone-50">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-sm" style={{ background: sectionColor(h.section) }} />
                        {SECTION_LABELS[h.section]}
                      </div>
                    </td>
                    <td className="text-right px-3 py-2.5 text-stone-700">{L(h.y1)}</td>
                    <td className="text-right px-3 py-2.5">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 bg-stone-100 rounded-full">
                          <div className="h-full rounded-full" style={{ width: `${h.pct}%`, background: sectionColor(h.section) }} />
                        </div>
                        <span className="text-xs text-stone-600 w-10 text-right">{h.pct.toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <div className="px-4 py-3 border-t border-stone-100 grid grid-cols-1 sm:grid-cols-3 gap-3 bg-stone-50">
              <MiniStat label="Salary %" value={gt1 > 0 ? `${(salaryTotal/gt1*100).toFixed(1)}%` : "–"} />
              <MiniStat label="Programme %" value={gt1 > 0 ? `${(programmeTotal/gt1*100).toFixed(1)}%` : "–"} />
              <MiniStat label="Admin %" value={gt1 > 0 ? `${(adminTotal/gt1*100).toFixed(1)}%` : "–"}
                note={adminTotal/gt1 > 0.15 ? "above 15% limit" : undefined} />
            </div>
          </div>
        </section>

        {inp.nSettlements > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-stone-700 mb-3">Per-Settlement Analysis</h2>
            <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100 bg-stone-50 text-xs text-stone-500">
                    <th className="text-left px-4 py-2.5">Metric</th>
                    <th className="text-right px-3 py-2.5">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["No. of settlements", String(inp.nSettlements)],
                    ["No. of clusters", String(inp.nClusters)],
                    ["Avg settlements per cluster", inp.nClusters > 0 ? (inp.nSettlements / inp.nClusters).toFixed(1) : "–"],
                    ["Cost per settlement / year", gt1 > 0 ? INR(gt1 / inp.nSettlements) : "–"],
                    ["Cost per household / year", gt1 > 0 ? INR(gt1 / (inp.nSettlements * AVG_HH_PER_SETTLEMENT)) : "–"],
                    ["Cost per cluster / year", inp.nClusters > 0 && gt1 > 0 ? L(gt1 / inp.nClusters) : "–"],
                  ].map(([label, val]) => (
                    <tr key={label} className="border-b border-stone-50">
                      <td className="px-4 py-2.5 text-stone-600">{label}</td>
                      <td className="text-right px-3 py-2.5 font-medium text-stone-800">{val}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {bands.length > 1 && (
          <section>
            <h2 className="text-sm font-semibold text-stone-700 mb-3">{horizonDisplay} Cost Projection</h2>
            <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full min-w-[380px] text-sm">
                <thead>
                  <tr className="border-b border-stone-100 bg-stone-50 text-xs text-stone-500">
                    <th className="text-left px-4 py-2.5">Year</th>
                    <th className="text-right px-3 py-2.5">Total</th>
                    <th className="text-right px-3 py-2.5">vs Y1</th>
                    <th className="text-right px-3 py-2.5">Per beneficiary</th>
                  </tr>
                </thead>
                <tbody>
                  {bands.map(b => {
                    const total = grandTotal(b.k);
                    return (
                      <tr key={b.k} className="border-b border-stone-50">
                        <td className="px-4 py-2.5 text-stone-700">{b.label}</td>
                        <td className="text-right px-3 py-2.5 font-medium text-stone-800">{L(total)}</td>
                        <td className="text-right px-3 py-2.5 text-xs text-stone-500">
                          {gt1 > 0 && total !== gt1 ? `${total > gt1 ? "+" : ""}${((total/gt1 - 1)*100).toFixed(1)}%` : "–"}
                        </td>
                        <td className="text-right px-3 py-2.5 text-stone-600">
                          {totalBeneficiaries > 0 ? INR(total / totalBeneficiaries) : "–"}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-stone-50 font-medium">
                    <td className="px-4 py-2.5 text-stone-700">{horizonDisplay} Total</td>
                    <td className="text-right px-3 py-2.5 text-sky-700">{L(horizonTotal)}</td>
                    <td colSpan={2} />
                  </tr>
                </tbody>
              </table>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${highlight ? "bg-sky-50 border-sky-200" : "bg-white border-stone-200"}`}>
      <div className="text-xs text-stone-500">{label}</div>
      <div className={`text-xl font-bold mt-0.5 ${highlight ? "text-sky-700" : "text-stone-900"}`}>{value}</div>
      {sub && <div className="text-xs text-stone-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function MiniStat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <div className="text-xs text-stone-400">{label}</div>
      <div className={`text-sm font-semibold ${note ? "text-red-600" : "text-stone-800"}`}>{value}</div>
      {note && <div className="text-xs text-red-400">{note}</div>}
    </div>
  );
}

function sectionColor(section: BudgetSection): string {
  const map: Partial<Record<BudgetSection, string>> = {
    salary: "#6366f1", capex: "#f59e0b", travel: "#10b981",
    programme: "#0ea5e9", admin_salary: "#8b5cf6", admin_other: "#ec4899",
  };
  return map[section] ?? "#94a3b8";
}
