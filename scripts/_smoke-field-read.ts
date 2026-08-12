// Smoke test the /field read path against real data (no browser). Exercises the
// same functions the three pages call. Read-only.
import { prisma } from "../lib/prisma";
import { loadInterventions, loadIntervention, loadClusterSummaries } from "../lib/field/queries";

async function main() {
  // Pick an owner of a live creche goal to stand in for the RP.
  const goal = await prisma.goal.findFirst({
    where: { needsDomain: "Creche", title: { contains: "Royapuram" } },
    select: { id: true, ownerId: true, needsClusterId: true, linkedFacility: { select: { clusterId: true } }, needsSettlement: { select: { clusterId: true } } },
  });
  if (!goal) return console.log("no creche goal found");
  const userId = goal.ownerId;
  const clusterId = goal.needsClusterId ?? goal.linkedFacility?.clusterId ?? goal.needsSettlement?.clusterId ?? undefined;

  console.log("=== loadClusterSummaries ===");
  const clusters = await loadClusterSummaries(userId);
  for (const c of clusters.slice(0, 8)) console.log(`  ${c.name}: live=${c.live} settingUp=${c.settingUp} attention=${c.attention}`);
  console.log(`  (${clusters.length} clusters total)`);

  if (clusterId) {
    console.log(`\n=== loadInterventions(cluster=${clusterId}) ===`);
    const rows = await loadInterventions(userId, clusterId);
    for (const r of rows.slice(0, 8)) console.log(`  [${r.phase}] ${r.locationName} — setup ${r.setupDone}/${r.setupTotal} · visits ${r.visitDone}/${r.visitRequired} · ${r.openFollowups} fu ${r.needsAttention ? "⚠" : ""}`);
    console.log(`  (${rows.length} interventions)`);
  }

  console.log(`\n=== loadIntervention(${goal.id}) ===`);
  const d = await loadIntervention(goal.id);
  if (!d) return console.log("  null");
  console.log(`  ${d.locationName} · ${d.domainLabel} · phase=${d.phase}`);
  console.log(`  setup ${d.setupDone}/${d.setupTotal}; visitsThisMonth ${d.visitDoneThisMonth}/${d.visitRequired}; recipe steps ${d.visitSteps.length}; followups ${d.followups.length}`);
  const nextSetup = d.setupSteps.find((s) => s.status !== "Done");
  if (nextSetup) console.log(`  next setup step: "${nextSetup.title}" blocked=${nextSetup.blocked} overdue=${nextSetup.overdue} form=${nextSetup.formKind}`);
  for (const vs of d.visitSteps) console.log(`  visit recipe: "${vs.title}" mandatory=${vs.mandatory} form=${vs.formKind ?? "-"} done=${vs.done}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
