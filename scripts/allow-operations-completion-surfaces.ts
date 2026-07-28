// The member (RP) role's `pitstop_event.update` grant was surface-restricted (via the admin UI) to
// home.*/activities.* surfaces only — so completing an activity from the Operations world (the live
// visit `operations.visit`, or a setup centre's `operations.theme_portal`) was denied, which is why
// voice/upload "rotate then nothing". This adds the RP-facing operations.* surfaces to that grant's
// allowlist (idempotent — leaves the existing surfaces + other grants untouched). No full re-seed.
//
// Run: npx tsx scripts/allow-operations-completion-surfaces.ts
import prisma from "@/lib/prisma";

const ADD = [
  "operations.home",
  "operations.today",
  "operations.theme_portal",
  "operations.month_planner",
  "operations.visit",
];

async function main() {
  const rows = await prisma.$queryRawUnsafe<{ id: string; role: string; scopeRule: { kind?: string; surfaces?: string[] } }[]>(`
    SELECT rp.id, r.name AS role, rp."scopeRule"
    FROM "RolePermission" rp
    JOIN "Permission" p ON p.id = rp."permissionId"
    JOIN "Role" r ON r.id = rp."roleId"
    WHERE p.resource = 'pitstop_event' AND p.action = 'update'
  `);

  for (const row of rows) {
    const sr = row.scopeRule ?? {};
    const surfaces = Array.isArray(sr.surfaces) ? sr.surfaces : null;
    // Only touch grants that ARE surface-restricted (an empty/absent list = unrestricted = fine).
    if (!surfaces || surfaces.length === 0) { console.log(`${row.role}: unrestricted — skipped`); continue; }
    const merged = [...new Set([...surfaces, ...ADD])];
    if (merged.length === surfaces.length) { console.log(`${row.role}: already allows operations.* — skipped`); continue; }
    await prisma.rolePermission.update({
      where: { id: row.id },
      data: { scopeRule: { ...sr, surfaces: merged } },
    });
    console.log(`${row.role}: added ${merged.length - surfaces.length} operations surface(s) → ${JSON.stringify(merged)}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
