import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { prisma } from "../lib/prisma";

function summariseCats(cats: any): string[] {
  const out: string[] = [];
  if (!Array.isArray(cats)) return out;
  for (const c of cats) {
    const items = Array.isArray(c?.items) ? c.items : [];
    out.push(`  [${c?.label ?? c?.key}] (${items.length}): ` +
      items.map((i: any) => `${i?.text ?? i?.key}${i?.ref ? "*" : ""}`).join(" | "));
  }
  return out;
}

async function main() {
  // The domain-default catalog(s)
  const defs = await prisma.catalogTemplateDef.findMany({
    orderBy: { updatedAt: "desc" },
    select: { slug: true, name: true, needsDomain: true, isActive: true, updatedAt: true, categories: true },
  });
  console.log("=== CatalogTemplateDef (domain defaults) ===");
  for (const d of defs) {
    console.log(`\n• slug=${d.slug} domain=${d.needsDomain} active=${d.isActive} updatedAt=${d.updatedAt.toISOString()}`);
    summariseCats(d.categories).forEach((l) => console.log(l));
  }

  const goals = await prisma.goal.findMany({
    where: { title: { contains: "Creche Programme", mode: "insensitive" }, deletedAt: null },
    select: { id: true, title: true, needsDomain: true, mode: true, centreCatalog: {
      select: { catalogSlug: true, snapshot: true, overrides: true, cadenceCount: true, cadencePeriod: true, createdAt: true, updatedAt: true },
    } },
    orderBy: { title: "asc" },
  });

  console.log("\n\n=== Per-centre CentreCatalog snapshots ===");
  for (const g of goals) {
    const cc = g.centreCatalog;
    if (!cc) { console.log(`${g.title}: (setup — not live)`); continue; }
    const cats = ((cc.snapshot as any)?.categories ?? cc.snapshot) as any[];
    const firstSafety = Array.isArray(cats) ? (cats.find((c) => /safety/i.test(c?.label ?? c?.key))?.items?.[0]?.text ?? "?") : "?";
    const stale = !/24-point/i.test(firstSafety);
    console.log(`${stale ? "STALE " : "  ok  "} | live=${cc.createdAt.toISOString().slice(0,10)} | firstSafetyItem="${firstSafety}" | ${g.title}`);
  }
}

main().finally(() => prisma.$disconnect());
