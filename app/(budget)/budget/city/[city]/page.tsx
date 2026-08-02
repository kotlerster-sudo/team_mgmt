import { auth } from "@/lib/auth";
import { isBudgetAdminOrSuperAdmin } from "@/lib/roleGuard";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import DeleteBudgetButton from "../../DeleteBudgetButton";

const fmt = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)}Cr` : `₹${(n / 1e5).toFixed(1)}L`);

export default async function CityBudgetsPage({ params }: { params: Promise<{ city: string }> }) {
  const session = await auth();
  if (!session?.user || !isBudgetAdminOrSuperAdmin(session)) redirect("/budget");
  const city = decodeURIComponent((await params).city);

  const budgets = await prisma.budget.findMany({
    where: { city },
    include: {
      lines: { select: { y1Total: true, y2Total: true, y3Total: true } },
      grantPartner: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const domainConfigs = await prisma.budgetDomainConfig.findMany({ select: { key: true, label: true } });
  const domainLabels = Object.fromEntries(domainConfigs.map((d) => [d.key, d.label]));
  const cityQ = `?city=${encodeURIComponent(city)}`;

  return (
    <div>
      <div className="mb-2">
        <Link href="/budget" className="text-xs text-stone-400 hover:text-stone-600">← All cities</Link>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-xl font-semibold text-stone-900">{city} budgets</h1>
        <div className="flex gap-2">
          <Link href={`/budget/import${cityQ}`} className="border border-stone-300 text-stone-700 text-sm px-4 py-2 rounded-lg hover:bg-stone-50">
            Import
          </Link>
          <Link href={`/budget/new${cityQ}`} className="bg-sky-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-sky-700">
            + New Budget
          </Link>
        </div>
      </div>

      {budgets.length === 0 && (
        <div className="text-center py-20 text-stone-400">
          <p className="text-sm">No budgets in {city} yet.</p>
          <Link href={`/budget/new${cityQ}`} className="mt-3 inline-block text-sky-600 text-sm hover:underline">Create the first one →</Link>
        </div>
      )}

      <div className="grid gap-3">
        {budgets.map((b) => {
          const y1 = b.lines.reduce((s, l) => s + l.y1Total, 0);
          const y3 = b.lines.reduce((s, l) => s + l.y1Total + l.y2Total + l.y3Total, 0);
          return (
            <div key={b.id} className="relative bg-white border border-stone-200 rounded-xl hover:border-sky-300 hover:shadow-sm transition-all">
              <Link href={`/budget/${b.id}`} className="block px-4 sm:px-5 py-4 pr-12">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-stone-900">{b.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${b.status === "approved" ? "bg-emerald-100 text-emerald-700" : b.status === "final" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                        {b.status === "approved" ? "Approved" : b.status === "final" ? "Finalized" : "Draft"}
                      </span>
                      {b.grantPartner && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-sky-50 text-sky-700">{b.grantPartner.name}</span>
                      )}
                      <span className="text-xs text-stone-400">{b.years === 3 ? "3-year" : `${b.years}-year`}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {b.domains.map((d) => (
                        <span key={d} className="text-xs bg-stone-100 text-stone-600 px-2 py-0.5 rounded">{domainLabels[d] ?? d}</span>
                      ))}
                    </div>
                  </div>
                  <div className="sm:text-right shrink-0 sm:pr-14">
                    <div className="text-sm font-semibold text-stone-900">{fmt(y1)}<span className="text-stone-400 font-normal">/yr</span></div>
                    {b.years === 3 && <div className="text-xs text-stone-400">{fmt(y3)} total (3yr)</div>}
                  </div>
                </div>
              </Link>
              {b.status === "approved" && (
                <Link href={`/budget/${b.id}/reports`} className="absolute bottom-4 right-14 text-xs text-emerald-600 hover:underline">Reports →</Link>
              )}
              <div className="absolute top-3 right-3"><DeleteBudgetButton budgetId={b.id} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
