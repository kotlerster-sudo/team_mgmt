import prisma from "@/lib/prisma";
import Link from "next/link";
import { activeYearBands } from "@/lib/budget-generator";
import { auth } from "@/lib/auth";
import { isPartner } from "@/lib/roleGuard";
import { getPartnerAccess } from "@/lib/budget/partnerAccess";
import PartnerBudgetHome from "./PartnerBudgetHome";
import { listGrantingUnits } from "@/lib/budget/grantingUnits";

// ₹ in Cr when ≥ 1 Cr, else L.
function fmtINR(n: number): string {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  return `₹${(n / 1e5).toFixed(1)} L`;
}

function grantTotal(horizonMonths: number, lines: { y1Total: number; y2Total: number; y3Total: number; y4Total: number; y5Total: number }[]): number {
  const bands = activeYearBands(horizonMonths);
  return lines.reduce((s, l) => {
    let t = l.y1Total;
    if (bands >= 2) t += l.y2Total;
    if (bands >= 3) t += l.y3Total;
    if (bands >= 4) t += l.y4Total;
    if (bands >= 5) t += l.y5Total;
    return s + t;
  }, 0);
}

export default async function BudgetCityLandingPage() {
  const session = await auth();
  if (isPartner(session)) {
    const access = await getPartnerAccess(session);
    const budgets = access.grantPartnerId
      ? await prisma.budget.findMany({
          where: { grantPartnerId: access.grantPartnerId },
          include: {
            reportConfig: true,
            reportSlots: {
              orderBy: { slotNumber: "asc" },
              include: { report: { select: { submittedAt: true, approvedAt: true } } },
            },
          },
          orderBy: { updatedAt: "desc" },
        })
      : [];
    return <PartnerBudgetHome budgets={JSON.parse(JSON.stringify(budgets))} linked={!!access.grantPartnerId} />;
  }

  const [units, budgets] = await Promise.all([
    listGrantingUnits(),
    prisma.budget.findMany({
      select: {
        city: true, status: true, horizonMonths: true,
        lines: { select: { y1Total: true, y2Total: true, y3Total: true, y4Total: true, y5Total: true } },
      },
    }),
  ]);

  const stats: Record<string, { count: number; approved: number; approvedCount: number }> = {};
  for (const u of units) stats[u.name] = { count: 0, approved: 0, approvedCount: 0 };
  for (const b of budgets) {
    const bucket = stats[b.city] ?? (stats[b.city] = { count: 0, approved: 0, approvedCount: 0 });
    bucket.count += 1;
    if (b.status === "approved") {
      bucket.approved += grantTotal(b.horizonMonths, b.lines);
      bucket.approvedCount += 1;
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-xl font-semibold text-stone-900">Budgets</h1>
        <Link href="/budget/dashboard" className="bg-sky-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-sky-700">
          Grant dashboard →
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {units.map((u) => {
          const c = u.name;
          const s = stats[c];
          return (
            <Link
              key={u.id}
              href={`/budget/city/${encodeURIComponent(c)}`}
              className="block rounded-xl border border-stone-200 bg-white p-5 hover:border-sky-300 hover:shadow-sm transition-all"
            >
              <div className="text-lg font-semibold text-stone-900">{c}</div>
              <div className="mt-3 text-2xl font-bold text-stone-900">{fmtINR(s.approved)}</div>
              <div className="text-xs text-stone-500">approved across {s.approvedCount} grant{s.approvedCount === 1 ? "" : "s"}</div>
              <div className="mt-3 text-xs text-stone-400">{s.count} budget{s.count === 1 ? "" : "s"} total</div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
