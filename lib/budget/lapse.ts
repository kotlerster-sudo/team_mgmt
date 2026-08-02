// How much of each grant year a partner never spent. Unspent money lapses at the
// end of the year unless a reallocation carried it forward, so this is the record
// of grants that were larger than the work turned out to need — the signal when
// sizing the next one.
//
// Deliberately backward-looking: only years whose reports are all approved are
// counted. A year still being reported has an unspent balance by definition.

import prisma from "@/lib/prisma";

export type LapseYear = {
  grantYear: number;
  budgeted: number;
  actual: number;
  carriedForward: number;
  lapsed: number;
};

export type LapseDomain = {
  domain: string | null;
  budgeted: number;
  lapsed: number;
};

export type PartnerLapse = {
  partnerId: string;
  partnerName: string;
  city: string;
  budgeted: number;
  actual: number;
  carriedForward: number;
  lapsed: number;
  lapsePct: number;
  years: LapseYear[];
  byDomain: LapseDomain[];
  budgetCount: number;
};

type YearTotals = { y1Total: number; y2Total: number; y3Total: number; y4Total: number; y5Total: number };

const yearTotalOf = (line: YearTotals, grantYear: number) =>
  grantYear === 1 ? line.y1Total
  : grantYear === 2 ? line.y2Total
  : grantYear === 3 ? line.y3Total
  : grantYear === 4 ? line.y4Total
  : line.y5Total;

/** Per (grantYear, budgetLineId) accumulator. */
type Cell = { budgeted: number; actual: number; carried: number };
const cellKey = (year: number, lineId: string) => `${year}|${lineId}`;

export async function partnerLapseRecords(): Promise<PartnerLapse[]> {
  const budgets = await prisma.budget.findMany({
    where: { status: "approved", grantPartnerId: { not: null } },
    select: {
      id: true, city: true,
      grantPartner: { select: { id: true, name: true } },
      lines: {
        select: {
          id: true, domain: true, templateKey: true,
          y1Total: true, y2Total: true, y3Total: true, y4Total: true, y5Total: true,
        },
      },
      reportSlots: {
        select: {
          grantYear: true, status: true,
          report: {
            select: {
              lines: { select: { budgetLineId: true, actualAmount: true } },
              reallocationRequests: {
                where: { status: "approved" },
                select: { fromLineId: true, toLineId: true, approvedAmount: true, targetGrantYear: true },
              },
            },
          },
        },
      },
    },
  });

  const byPartner = new Map<string, PartnerLapse>();

  for (const b of budgets) {
    const partner = b.grantPartner;
    if (!partner) continue;

    // A year is only readable once every one of its reports is in. Anything
    // still open has an unspent balance that simply hasn't been spent yet.
    const yearsSeen = new Map<number, { total: number; approved: number }>();
    for (const s of b.reportSlots) {
      const y = yearsSeen.get(s.grantYear) ?? { total: 0, approved: 0 };
      y.total++;
      if (s.status === "approved") y.approved++;
      yearsSeen.set(s.grantYear, y);
    }
    const closedYears = new Set(
      [...yearsSeen].filter(([, c]) => c.total > 0 && c.total === c.approved).map(([y]) => y),
    );
    if (closedYears.size === 0) continue;

    const cells = new Map<string, Cell>();
    const cell = (year: number, lineId: string) => {
      const k = cellKey(year, lineId);
      let c = cells.get(k);
      if (!c) { c = { budgeted: 0, actual: 0, carried: 0 }; cells.set(k, c); }
      return c;
    };

    for (const year of closedYears) {
      for (const line of b.lines) cell(year, line.id).budgeted = yearTotalOf(line, year);
    }

    for (const s of b.reportSlots) {
      for (const l of s.report?.lines ?? []) {
        if (!closedYears.has(s.grantYear)) continue;
        cell(s.grantYear, l.budgetLineId).actual += l.actualAmount;
      }
      for (const r of s.report?.reallocationRequests ?? []) {
        if (r.approvedAmount == null) continue;
        if (r.targetGrantYear == null) {
          // Moved within the year: the source line's budget shrank, the
          // destination's grew. Neither lapsed.
          if (closedYears.has(s.grantYear)) {
            cell(s.grantYear, r.fromLineId).budgeted -= r.approvedAmount;
            if (r.toLineId) cell(s.grantYear, r.toLineId).budgeted += r.approvedAmount;
          }
        } else {
          // Carried forward: it left this year without being spent here, but it
          // did not lapse — it landed on a later year's line.
          if (closedYears.has(s.grantYear)) cell(s.grantYear, r.fromLineId).carried += r.approvedAmount;
          if (r.toLineId && closedYears.has(r.targetGrantYear)) {
            cell(r.targetGrantYear, r.toLineId).budgeted += r.approvedAmount;
          }
        }
      }
    }

    const domainOf = new Map(b.lines.map((l) => [l.id, l.domain]));
    let rec = byPartner.get(partner.id);
    if (!rec) {
      rec = {
        partnerId: partner.id, partnerName: partner.name, city: b.city,
        budgeted: 0, actual: 0, carriedForward: 0, lapsed: 0, lapsePct: 0,
        years: [], byDomain: [], budgetCount: 0,
      };
      byPartner.set(partner.id, rec);
    }
    rec.budgetCount++;

    for (const [k, c] of cells) {
      const [yearStr, lineId] = k.split("|");
      const year = Number(yearStr);
      const lapsed = Math.max(0, c.budgeted - c.actual - c.carried);

      rec.budgeted += c.budgeted;
      rec.actual += c.actual;
      rec.carriedForward += c.carried;
      rec.lapsed += lapsed;

      const yr = rec.years.find((y) => y.grantYear === year);
      if (yr) {
        yr.budgeted += c.budgeted; yr.actual += c.actual;
        yr.carriedForward += c.carried; yr.lapsed += lapsed;
      } else {
        rec.years.push({ grantYear: year, budgeted: c.budgeted, actual: c.actual, carriedForward: c.carried, lapsed });
      }

      const domain = domainOf.get(lineId) ?? null;
      const dom = rec.byDomain.find((d) => d.domain === domain);
      if (dom) { dom.budgeted += c.budgeted; dom.lapsed += lapsed; }
      else rec.byDomain.push({ domain, budgeted: c.budgeted, lapsed });
    }
  }

  const records = [...byPartner.values()];
  for (const r of records) {
    r.lapsePct = r.budgeted > 0 ? (r.lapsed / r.budgeted) * 100 : 0;
    r.years.sort((a, b) => a.grantYear - b.grantYear);
    r.byDomain.sort((a, b) => b.lapsed - a.lapsed);
  }
  return records.sort((a, b) => b.lapsePct - a.lapsePct);
}
