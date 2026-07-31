// READ-ONLY: ground truth on the hygiene item's completion type across the
// template (authoritative for materialisation), the catalog, and the actual
// materialised ChecklistItems.
// Run: npx tsx scripts/check-hygiene-completiontype.ts

import { config } from "dotenv"; config({ path: ".env.local" });
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const HKEY = "hygiene-and-safety-standards-checked-against-24-point-checklist";

async function main() {
  // GoalTemplateDef authoritative completionType (checklist + activities)
  const tpl = await p.$queryRaw<{ pitstops: unknown }[]>`
    SELECT pitstops FROM "GoalTemplateDef" WHERE slug = 'creche-program-existing' LIMIT 1`;
  const pitstops = (tpl[0]?.pitstops as { checklist?: { key?: string; text?: string; completionType?: string; activities?: { title?: string; completionType?: string }[] }[] }[]) ?? [];
  for (const ps of pitstops) for (const c of ps.checklist ?? []) {
    if (c.key === HKEY) {
      console.log("TEMPLATE hygiene checklist item:");
      console.log("  c.completionType =", JSON.stringify(c.completionType));
      console.log("  activities =", JSON.stringify(c.activities));
    }
  }

  // Materialised ChecklistItems (the live completion path reads this).
  // NB: ChecklistItem has no deletedAt column.
  const cis = await p.$queryRaw<{ completionType: string; n: number }[]>`
    SELECT "completionType"::text AS "completionType", count(*)::int AS n
    FROM "ChecklistItem" WHERE key = ${HKEY}
    GROUP BY "completionType"`;
  console.log("\nMaterialised ChecklistItems by completionType:", cis);

  // Of those, how many are on still-open (not-Done) child events
  const open = await p.$queryRaw<{ completionType: string; n: number }[]>`
    SELECT ci."completionType"::text AS "completionType", count(DISTINCT ci.id)::int AS n
    FROM "ChecklistItem" ci
    JOIN "PitstopEvent" pe ON pe."checklistItemId" = ci.id AND pe."deletedAt" IS NULL AND pe.status NOT IN ('Done','Cancelled')
    WHERE ci.key = ${HKEY}
    GROUP BY ci."completionType"`;
  console.log("ChecklistItems with an OPEN activity:", open);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
