// P1 — Seed /field templates for the creche domain by DERIVING them from the
// existing control-plane config (no retyping, stays faithful to live data):
//
//   SetupStepTemplate  ← creche-program pitstops (one step per pitstop, ~9 steps
//                         with SLAs; the pitstop's checklist items become an
//                         optional in-step "checklist" form — preserved, not lost).
//   VisitStepTemplate  ← creche-visit-catalog items + the "Monthly Creche Rounds"
//                         live template (the ~monthly visit recipe).
//   FieldDomainConfig  ← catalog cadence + overall setup SLA + geo grain.
//
// Idempotent: upserts on (domain, stepKey) / domain PK. Re-runnable.
// Run: DATABASE_URL=... npx tsx scripts/seed-field-templates-creche.ts
import { prisma } from "../lib/prisma";

const DOMAIN = "Creche";
const SETUP_TEMPLATE_SLUG = "creche-program";
const LIVE_TEMPLATE_SLUG = "creche-program-existing";
const CATALOG_SLUG = "creche-visit-catalog";

async function main() {
  // ── Setup steps: derive from creche-program pitstops ──────────────────────
  const setupTemplate = await prisma.goalTemplateDef.findUnique({
    where: { slug: SETUP_TEMPLATE_SLUG },
    include: {
      pitstopDefs: {
        orderBy: { order: "asc" },
        include: { checklist: { orderBy: { order: "asc" } } },
      },
    },
  });
  if (!setupTemplate) throw new Error(`Setup template '${SETUP_TEMPLATE_SLUG}' not found`);

  // Keep only one-time setup pitstops (drop recurring monitoring, if any slipped in).
  const setupPitstops = setupTemplate.pitstopDefs.filter((p) => (p.recurrence ?? "None") === "None");

  let overallSlaDays = 0;
  let prevKey: string | null = null;
  let prevSla = 0;
  let order = 0;
  for (const p of setupPitstops) {
    const sla = p.slaDays ?? null;
    const startSla = p.startSlaDays ?? 0;
    if (sla != null) overallSlaDays = Math.max(overallSlaDays, sla);

    // Sequential chain: a step is blocked by the previous one when it starts at
    // or after the previous step's due date. startSla===0 (and not first) = parallel.
    const blockedByKey = prevKey && startSla > 0 && startSla >= prevSla ? prevKey : null;

    const items = p.checklist.map((c) => ({ key: c.key, text: c.text }));
    const formKind = items.length > 0 ? "checklist" : null;
    const formSchema = items.length > 0 ? { items } : undefined;

    await prisma.setupStepTemplate.upsert({
      where: { domain_stepKey: { domain: DOMAIN, stepKey: p.key } },
      create: {
        domain: DOMAIN,
        order,
        stepKey: p.key,
        title: p.title,
        slaDays: sla,
        startSlaDays: startSla,
        blockedByKey,
        formKind,
        formSchema,
      },
      update: {
        order,
        title: p.title,
        slaDays: sla,
        startSlaDays: startSla,
        blockedByKey,
        formKind,
        formSchema: formSchema ?? undefined,
        isActive: true,
      },
    });
    console.log(
      `  setup[${order}] ${p.key}  sla=${sla} start=${startSla} blockedBy=${blockedByKey ?? "-"} items=${items.length}`,
    );
    prevKey = p.key;
    prevSla = sla ?? prevSla;
    order += 1;
  }

  // ── Visit steps: derive from live template + catalog ──────────────────────
  const liveTemplate = await prisma.goalTemplateDef.findUnique({
    where: { slug: LIVE_TEMPLATE_SLUG },
    include: { pitstopDefs: { include: { checklist: { orderBy: { order: "asc" } } } } },
  });
  const catalog = await prisma.catalogTemplateDef.findUnique({
    where: { slug: CATALOG_SLUG },
    include: { categoryDefs: { orderBy: { order: "asc" }, include: { items: { orderBy: { order: "asc" } } } } },
  });

  // 24-point hygiene & safety checklist items (live in FacilityIndicatorDef
  // "creche_hygiene_score") — attached as a checklist form on the safety step.
  const hygieneDef = await prisma.facilityIndicatorDef.findFirst({
    where: { key: "creche_hygiene_score" },
    select: { checklistItems: { where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { itemKey: true, text: true, category: true } } },
  });
  const safetyItems = (hygieneDef?.checklistItems ?? []).map((it) => ({ key: it.itemKey, text: it.text, category: it.category ?? null }));
  const isSafetyStep = (key: string, title: string) => /24-point/i.test(key) || /24-point/i.test(title) || (/hygiene/i.test(key) && /safety/i.test(key));

  // Compose the monthly visit recipe: the round checklist items, plus catalog
  // items that carry a form (caregiver practices). De-dup by stepKey.
  type VisitStep = { stepKey: string; title: string; mandatory: boolean; formKind: string | null; formSchema?: unknown };
  const visitSteps: VisitStep[] = [];
  const seen = new Set<string>();
  const push = (s: VisitStep) => {
    if (seen.has(s.stepKey)) return;
    seen.add(s.stepKey);
    visitSteps.push(s);
  };

  // From "Monthly Creche Rounds" — the operational things an RP does each visit.
  // The 24-point safety item gets its checklist form attached.
  for (const p of liveTemplate?.pitstopDefs ?? []) {
    for (const c of p.checklist) {
      const safety = isSafetyStep(c.key, c.text) && safetyItems.length > 0;
      push({ stepKey: c.key, title: c.text, mandatory: true, formKind: safety ? "checklist" : null, formSchema: safety ? { items: safetyItems } : undefined });
    }
  }
  // From the catalog — attach the caregiver-practices form to that item.
  for (const cat of catalog?.categoryDefs ?? []) {
    for (const it of cat.items) {
      const isCaregiver = /caregiver/i.test(it.key) || /caregiver/i.test(it.text);
      push({
        stepKey: it.key,
        title: it.text,
        mandatory: it.blocksSignoff,
        formKind: isCaregiver ? "caregiver_practices" : null,
      });
    }
  }

  let vorder = 0;
  for (const s of visitSteps) {
    await prisma.visitStepTemplate.upsert({
      where: { domain_stepKey: { domain: DOMAIN, stepKey: s.stepKey } },
      create: { domain: DOMAIN, order: vorder, stepKey: s.stepKey, title: s.title, mandatory: s.mandatory, formKind: s.formKind, formSchema: s.formSchema as never },
      update: { order: vorder, title: s.title, mandatory: s.mandatory, formKind: s.formKind, formSchema: (s.formSchema ?? null) as never, isActive: true },
    });
    const nItems = (s.formSchema as { items?: unknown[] })?.items?.length ?? 0;
    console.log(`  visit[${vorder}] ${s.stepKey}  mandatory=${s.mandatory} form=${s.formKind ?? "-"}${nItems ? ` (${nItems} items)` : ""}`);
    vorder += 1;
  }

  // ── Domain config ─────────────────────────────────────────────────────────
  const cadenceCount = catalog?.defaultCadenceCount ?? 1;
  const cadencePeriod = catalog?.defaultCadencePeriod ?? "month";
  await prisma.fieldDomainConfig.upsert({
    where: { domain: DOMAIN },
    create: {
      domain: DOMAIN,
      label: "Creche",
      unit: "settlement",
      overallSlaDays,
      cadenceCount,
      cadencePeriod,
      hasLivePhase: true,
      sortOrder: 0,
    },
    update: { label: "Creche", unit: "settlement", overallSlaDays, cadenceCount, cadencePeriod, hasLivePhase: true, isActive: true },
  });
  console.log(
    `\n  domain '${DOMAIN}': ${order} setup steps (overall SLA ${overallSlaDays}d), ${vorder} visit steps, cadence ${cadenceCount}/${cadencePeriod}`,
  );
}

main()
  .then(() => console.log("\n✔ creche field templates seeded"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
