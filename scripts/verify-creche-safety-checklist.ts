// READ-ONLY: verify the seeded 24-point creche safety tick-list + find a
// pending hygiene activity to test the completion modal against.
// Run:  npx tsx scripts/verify-creche-safety-checklist.ts

import { config } from "dotenv"; config({ path: ".env.local" });
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const counts = await p.$queryRaw<{ total: number; nn: number; na: number }[]>`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE i."nonNegotiable")::int AS nn,
           count(*) FILTER (WHERE i."naAllowed")::int AS na
    FROM "IndicatorChecklistItemDef" i
    JOIN "FacilityIndicatorDef" d ON d.id = i."defId"
    WHERE d.key = 'creche_hygiene_score' AND i."isActive"`;
  console.log("items:", counts[0]);

  const cats = await p.$queryRaw<{ category: string; n: number }[]>`
    SELECT i.category, count(*)::int AS n FROM "IndicatorChecklistItemDef" i
    JOIN "FacilityIndicatorDef" d ON d.id = i."defId"
    WHERE d.key = 'creche_hygiene_score' AND i."isActive"
    GROUP BY i.category ORDER BY min(i."sortOrder")`;
  console.log("categories:", cats);

  const pending = await p.$queryRaw<{ id: string; status: string; day: string }[]>`
    SELECT pe.id, pe.status, pe."scheduledAt"::date::text AS day
    FROM "PitstopEvent" pe JOIN "ChecklistItem" ci ON ci.id = pe."checklistItemId"
    WHERE ci.key = 'hygiene-and-safety-standards-checked-against-24-point-checklist'
      AND pe.status NOT IN ('Done','Cancelled') AND pe."deletedAt" IS NULL
    ORDER BY pe."scheduledAt" DESC LIMIT 5`;
  console.log("pending hygiene activities:", pending);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
