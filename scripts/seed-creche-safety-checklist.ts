/**
 * Seeds the 24-point creche safety tick-list onto the `creche_hygiene_score`
 * facility indicator (IndicatorChecklistItemDef rows).
 *
 * Source: APF Creche Protocols → "Safety & Security at Creches" → Safety
 * Indicators (crecheprotocols.azimpremjifoundation.org). 6 categories,
 * 24 items, 19 non-negotiable (starred in the protocol).
 *
 * Phrasing note: protocol items 3–4 are questions where "yes" is NOT the
 * safe answer (a well within 20 m is a hazard; item 4 is conditional on a
 * well existing). Items here are rephrased so ticked = compliant, and the
 * conditional items carry naAllowed (N/A counts compliant), keeping
 * score = compliant count out of 24.
 *
 * Idempotent: items are upserted by (defId, itemKey) — text/category/flags/
 * order update on match, nothing is ever deleted (historical answers hang
 * off item ids). DB items not in this spec are reported and left untouched.
 *
 * Usage:
 *   set -a && source .env.local && set +a
 *   npx tsx scripts/seed-creche-safety-checklist.ts            # dry run
 *   npx tsx scripts/seed-creche-safety-checklist.ts --apply    # write
 */

import { randomUUID } from "crypto";
import prisma from "../lib/prisma";

const DEF_KEY = "creche_hygiene_score";

type ItemSpec = {
  itemKey: string;
  text: string;
  category: string;
  nonNegotiable?: boolean;
  naAllowed?: boolean;
};

const INFRA = "Infrastructural & Environmental Safety";
const PHYSICAL = "Physical Safety & Security";
const FIRE = "Fire Safety";
const ELECTRICAL = "Electrical Safety";
const FOOD = "Food Safety";
const OTHERS = "Others";

const ITEMS: ItemSpec[] = [
  // ── Infrastructural & Environmental Safety ────────────────────────────────
  { itemKey: "roof-walls-structural-safety", text: "Roof and walls are structurally safe", category: INFRA, nonNegotiable: true },
  { itemKey: "rain-leakage-protection", text: "Creche is protected from rainwater leakage", category: INFRA, nonNegotiable: true },
  { itemKey: "no-well-within-20m", text: "No well or tube-well within 20 m of the creche", category: INFRA, nonNegotiable: true },
  { itemKey: "well-covered-iron-net", text: "Well/tube-well within 20 m is covered with iron net inside and outside (N/A if no well)", category: INFRA, nonNegotiable: true, naAllowed: true },
  { itemKey: "sharp-cutters-machinery-away", text: "Sharp edge cutters or machinery kept away from the creche", category: INFRA, nonNegotiable: true },
  // ── Physical Safety & Security ────────────────────────────────────────────
  { itemKey: "external-fencing", text: "External fencing around the creche", category: PHYSICAL },
  { itemKey: "safety-gate-main-entrance", text: "Safety gate at the main entrance", category: PHYSICAL, nonNegotiable: true },
  { itemKey: "safety-gate-kitchen-entrance", text: "Safety gate at the kitchen entrance", category: PHYSICAL, nonNegotiable: true },
  { itemKey: "secured-against-animals", text: "Secured against entry of poisonous animals (snakes, scorpions) and domestic animals (dogs, cats, cows, hens)", category: PHYSICAL, nonNegotiable: true },
  { itemKey: "visitor-register-non-parents", text: "Entry of any person other than parents recorded in the visitor's register", category: PHYSICAL },
  // ── Fire Safety ───────────────────────────────────────────────────────────
  { itemKey: "gas-stove-separate-slab", text: "Separate slab or table for the gas stove, positioned above cylinder height", category: FIRE, nonNegotiable: true },
  { itemKey: "fire-extinguisher-working", text: "Fire extinguisher available and in working condition", category: FIRE, nonNegotiable: true },
  { itemKey: "fire-blankets-buckets-kitchen", text: "Fire blankets and fire buckets available in the kitchen", category: FIRE, nonNegotiable: true },
  { itemKey: "caregiver-pressure-cooker-confident", text: "Caregiver is confident in handling a pressure cooker", category: FIRE },
  // ── Electrical Safety ─────────────────────────────────────────────────────
  { itemKey: "electrical-connections-out-of-reach", text: "All electrical connections positioned out of children's reach", category: ELECTRICAL, nonNegotiable: true },
  { itemKey: "fans-lights-safe-height", text: "Fans and lights installed at a safe location and height", category: ELECTRICAL, nonNegotiable: true },
  { itemKey: "solar-panels-batteries-out-of-reach", text: "Solar panels or batteries kept out of children's reach (N/A if none)", category: ELECTRICAL, nonNegotiable: true, naAllowed: true },
  { itemKey: "lightning-arrestors-installed", text: "Lightning arrestors installed in the creche building", category: ELECTRICAL },
  // ── Food Safety ───────────────────────────────────────────────────────────
  { itemKey: "fifo-grains-rice", text: "Food grains and rice utilised first-in-first-out", category: FOOD, nonNegotiable: true },
  { itemKey: "periodic-egg-floating-tests", text: "Egg floating tests done periodically to check egg quality", category: FOOD, nonNegotiable: true },
  { itemKey: "leftover-food-disposed-daily", text: "Leftover food disposed of properly every day", category: FOOD, nonNegotiable: true },
  // ── Others ────────────────────────────────────────────────────────────────
  { itemKey: "two-caregivers-present", text: "Creche running with two caregivers during the visit", category: OTHERS, nonNegotiable: true },
  { itemKey: "first-aid-box-equipped", text: "Fully equipped first-aid box available in the creche", category: OTHERS, nonNegotiable: true },
  { itemKey: "emergency-contacts-displayed", text: "Emergency contact numbers clearly displayed", category: OTHERS },
];

const NEW_DESCRIPTION =
  "Score on the 24-point safety & hygiene tick-list (compliant items out of 24; N/A counts compliant). Items from the APF creche protocols — Safety & Security.";

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "APPLY MODE" : "DRY RUN (pass --apply to write)");

  const defs = await prisma.$queryRaw<{ id: string; description: string | null }[]>`
    SELECT id, description FROM "FacilityIndicatorDef" WHERE key = ${DEF_KEY} LIMIT 1
  `;
  const def = defs[0];
  if (!def) {
    console.error(
      `Indicator def "${DEF_KEY}" not found — run scripts/seed-layer2-indicators-existing.ts --apply first.`,
    );
    process.exit(1);
  }

  const existing = await prisma.$queryRaw<
    { id: string; itemKey: string; text: string; isActive: boolean }[]
  >`
    SELECT id, "itemKey", text, "isActive" FROM "IndicatorChecklistItemDef"
    WHERE "defId" = ${def.id}
  `;
  const byKey = new Map(existing.map(e => [e.itemKey, e]));

  let created = 0, updated = 0;
  for (let i = 0; i < ITEMS.length; i++) {
    const spec = ITEMS[i];
    const sortOrder = (i + 1) * 10;
    const cur = byKey.get(spec.itemKey);
    if (cur) {
      updated++;
      console.log(`  ~ update ${spec.itemKey}${cur.isActive ? "" : " (reactivate)"}`);
      if (apply) {
        await prisma.$executeRaw`
          UPDATE "IndicatorChecklistItemDef" SET
            text = ${spec.text},
            category = ${spec.category},
            "nonNegotiable" = ${spec.nonNegotiable === true},
            "naAllowed" = ${spec.naAllowed === true},
            "sortOrder" = ${sortOrder},
            "isActive" = true,
            "updatedAt" = NOW()
          WHERE id = ${cur.id}
        `;
      }
    } else {
      created++;
      console.log(`  + create ${spec.itemKey}${spec.nonNegotiable ? " ★" : ""}${spec.naAllowed ? " [N/A]" : ""}`);
      if (apply) {
        await prisma.$executeRaw`
          INSERT INTO "IndicatorChecklistItemDef" (
            id, "defId", "itemKey", text, category, "nonNegotiable",
            "naAllowed", "sortOrder", "isActive", "createdAt", "updatedAt"
          ) VALUES (
            ${randomUUID()}, ${def.id}, ${spec.itemKey}, ${spec.text}, ${spec.category},
            ${spec.nonNegotiable === true}, ${spec.naAllowed === true}, ${sortOrder},
            true, NOW(), NOW()
          )
        `;
      }
    }
  }

  const specKeys = new Set(ITEMS.map(s => s.itemKey));
  const strays = existing.filter(e => !specKeys.has(e.itemKey));
  for (const s of strays) {
    console.log(`  ! not in spec, left untouched: ${s.itemKey} (${s.isActive ? "active" : "inactive"})`);
  }

  if (apply) {
    await prisma.$executeRaw`
      UPDATE "FacilityIndicatorDef" SET description = ${NEW_DESCRIPTION}, "updatedAt" = NOW()
      WHERE id = ${def.id}
    `;
  }

  const nn = ITEMS.filter(s => s.nonNegotiable).length;
  console.log(
    `\n${apply ? "Done" : "Would apply"}: ${created} created, ${updated} updated, ${strays.length} strays left. ` +
      `${ITEMS.length} items (${nn} non-negotiable).`,
  );
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
