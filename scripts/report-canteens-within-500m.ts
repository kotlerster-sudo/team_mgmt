/**
 * scripts/report-canteens-within-500m.ts
 *
 * Regenerates the "Indira Canteens within 500m of a settlement" report from the
 * live SettlementCanteen links. Read-only. Writes:
 *   canteens-within-500m.md   (ranked, human-readable)
 *   canteens-within-500m.csv  (one row per canteen↔settlement link)
 *
 * Usage: npx tsx scripts/report-canteens-within-500m.ts [--maxM=500]
 */
import fs from "fs";

async function main() {
  const { prisma } = await import("../lib/prisma");
  const maxM = parseInt(process.argv.find(a => a.startsWith("--maxM="))?.replace("--maxM=", "") ?? "500", 10);
  const MAX = maxM / 1000;

  const links = await prisma.settlementCanteen.findMany({
    where: { distanceKm: { lte: MAX } },
    include: {
      canteen: true,
      settlement: { select: { name: true, cluster: { select: { name: true, zone: { select: { name: true } } } } } },
    },
    orderBy: { distanceKm: "asc" },
  });

  type Link = (typeof links)[number];
  const byCanteen = new Map<string, { name: string; rows: Link[] }>();
  for (const l of links) {
    const g = byCanteen.get(l.canteenId) ?? { name: l.canteen.name, rows: [] };
    g.rows.push(l);
    byCanteen.set(l.canteenId, g);
  }
  const canteens = [...byCanteen.values()].sort((a, b) => a.rows[0].distanceKm - b.rows[0].distanceKm);

  const m = (km: number) => Math.round(km * 1000);
  const loc = (r: Link) => {
    const cl = r.settlement.cluster?.name ?? "";
    const z = r.settlement.cluster?.zone?.name ?? "";
    return cl ? `[${cl}${z ? " / " + z : ""}]` : "";
  };

  // ── Markdown ──────────────────────────────────────────────────────────────
  const md: string[] = [];
  md.push(`# Indira Canteens within ${maxM}m of a settlement`);
  md.push("");
  md.push(`Derived from \`SettlementCanteen\` (haversine centroid→canteen distance). ${canteens.length} canteens, ${links.length} settlement links.`);
  md.push("");
  md.push(`| # | Canteen | Nearest settlement | Dist | Also within ${maxM}m |`);
  md.push(`|---|---|---|---|---|`);
  canteens.forEach((c, i) => {
    const n = c.rows[0];
    const also = c.rows.slice(1).map(r => `${r.settlement.name} ${m(r.distanceKm)}`).join(", ") || "—";
    md.push(`| ${i + 1} | ${c.name} | ${n.settlement.name} ${loc(n)} | ${m(n.distanceKm)} m | ${also} |`);
  });
  md.push("");
  fs.writeFileSync("canteens-within-500m.md", md.join("\n"));

  // ── CSV (one row per link) ────────────────────────────────────────────────
  const csv: string[] = ['canteen,settlement,cluster,zone,distance_m,is_nearest'];
  const q = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;
  for (const c of canteens) {
    c.rows.forEach((r, idx) => {
      csv.push([
        q(c.name), q(r.settlement.name),
        q(r.settlement.cluster?.name ?? ""), q(r.settlement.cluster?.zone?.name ?? ""),
        m(r.distanceKm), idx === 0 ? "yes" : "no",
      ].join(","));
    });
  }
  fs.writeFileSync("canteens-within-500m.csv", csv.join("\n") + "\n");

  console.log(`Wrote canteens-within-500m.md + .csv — ${canteens.length} canteens, ${links.length} links`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
