import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { prisma } from "../lib/prisma";
import { normalizeCategories, resolveEffectiveCatalog, type CatalogCategory, type CentreCatalogOverrides } from "../lib/catalogDb";

type ItemRef = { catKey: string; catLabel: string; key: string; text: string };

function flatten(cats: CatalogCategory[]): Map<string, ItemRef> {
  const m = new Map<string, ItemRef>();
  for (const c of normalizeCategories(cats ?? [])) {
    for (const it of c.items) m.set(`${c.key}::${it.key}`, { catKey: c.key, catLabel: c.label, key: it.key, text: it.text });
  }
  return m;
}

function asCats(snapshot: unknown): CatalogCategory[] {
  if (Array.isArray(snapshot)) return snapshot as CatalogCategory[];
  const c = (snapshot as any)?.categories;
  return Array.isArray(c) ? c : [];
}

async function main() {
  const defs = await prisma.catalogTemplateDef.findMany({ where: { isActive: true } });
  const defBySlug = new Map(defs.map((d) => [d.slug, d]));
  const defByDomain = new Map<string, typeof defs[number]>();
  for (const d of defs) if (d.needsDomain) defByDomain.set(d.needsDomain, d); // last wins; fine, one per domain

  const centres = await prisma.centreCatalog.findMany({
    select: {
      goalId: true, catalogSlug: true, snapshot: true, overrides: true, createdAt: true,
      goal: { select: { title: true, needsDomain: true, mode: true, deletedAt: true } },
    },
  });

  console.log(`Live centres with a CentreCatalog: ${centres.length}\n`);
  const stale: string[] = [];

  for (const c of centres) {
    if (c.goal.deletedAt) continue; // ignore soft-deleted goals whose CentreCatalog rows linger
    const def = defBySlug.get(c.catalogSlug) ?? (c.goal.needsDomain ? defByDomain.get(c.goal.needsDomain) : undefined);
    if (!def) { console.log(`?? no active def for slug=${c.catalogSlug} domain=${c.goal.needsDomain} — ${c.goal.title}`); continue; }

    const cur = flatten(def.categories as unknown as CatalogCategory[]);
    // Effective menu = what the visit screen actually shows (snapshot ⊕ overrides).
    const effective = resolveEffectiveCatalog(asCats(c.snapshot), c.overrides as CentreCatalogOverrides);
    const snap = flatten(effective.map((cc) => ({ key: cc.key, label: cc.label, items: cc.items })) as CatalogCategory[]);

    const missing = [...cur.values()].filter((i) => !snap.has(`${i.catKey}::${i.key}`)); // in current def, not in snapshot
    const extra = [...snap.values()].filter((i) => !cur.has(`${i.catKey}::${i.key}`)); // in snapshot, not in current def
    // text drift on matching keys
    const drift = [...cur.values()].filter((i) => {
      const s = snap.get(`${i.catKey}::${i.key}`);
      return s && s.text !== i.text;
    });

    const lag = missing.length || extra.length || drift.length;
    const tag = lag ? "LAG " : " ok ";
    console.log(`${tag}| live=${c.createdAt.toISOString().slice(0,10)} | slug=${c.catalogSlug} | ${c.goal.title}`);
    if (lag) {
      stale.push(c.goal.title);
      if (missing.length) console.log(`      + missing ${missing.length}: ${missing.map((i)=>i.text).join(" | ")}`);
      if (extra.length)   console.log(`      - extra   ${extra.length}: ${extra.map((i)=>i.text).join(" | ")}`);
      if (drift.length)   console.log(`      ~ drift   ${drift.length}: ${drift.map((i)=>i.text).join(" | ")}`);
    }
  }

  console.log(`\n=== ${stale.length} centre(s) with lag ===`);
  stale.forEach((s) => console.log(` - ${s}`));

  // Deep dump for Royapuram: overrides + category-key compatibility with current def
  const roy = centres.find((c) => /royapuram/i.test(c.goal.title));
  if (roy) {
    const def = defBySlug.get(roy.catalogSlug)!;
    console.log(`\n=== Royapuram deep dump ===`);
    console.log("current def category keys:", normalizeCategories(def.categories as any).map((c) => c.key).join(", "));
    console.log("snapshot category keys:   ", normalizeCategories(asCats(roy.snapshot)).map((c) => c.key).join(", "));
    console.log("overrides:", JSON.stringify(roy.overrides, null, 2));
  }
}

main().finally(() => prisma.$disconnect());
