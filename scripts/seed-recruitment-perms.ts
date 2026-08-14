/**
 * Seed the four `recruitment.*` permissions into the DB and grant them to
 * super-admin only. Idempotent — safe to re-run.
 *
 * Written as a targeted script (NOT scripts/seed-role.ts / seedRole()) because
 * per [[rbac_system]], seedRole() deletes+recreates all of a role's grants,
 * which would drop anything an admin edited via /settings/roles. This script
 * only upserts the four Permission rows and the four super-admin
 * RolePermission rows — nothing else in the RBAC catalog is touched.
 *
 * Run:   pnpm tsx scripts/seed-recruitment-perms.ts
 *
 * .env.local == prod DB — running locally hits prod. That's intentional here.
 * After running, the in-process rbac cache on running Vercel instances is
 * stale for up to 60s (ROLE_PERMS_TTL_MS). Wait a minute, or bounce the
 * deployment (redeploy same commit) if you want it live immediately.
 */

import "dotenv/config";

const RECRUITMENT_ACTIONS = ["list", "read", "create", "delete"] as const;

async function main() {
  const { default: prisma } = await import("../lib/prisma");

  // 1. Upsert the four Permission catalog rows.
  const perms = await Promise.all(
    RECRUITMENT_ACTIONS.map((action) =>
      prisma.permission.upsert({
        where: { resource_action: { resource: "recruitment", action } },
        create: { resource: "recruitment", action },
        update: {},
      }),
    ),
  );
  console.log(`[seed-recruitment-perms] ${perms.length} Permission rows ensured.`);

  // 2. Grant to super-admin only. Never touch admin/member/viewer/etc. — the
  // recruitment resource is opt-in per role via /settings/roles.
  const superAdmin = await prisma.role.findUnique({ where: { name: "super-admin" } });
  if (!superAdmin) {
    throw new Error("super-admin role not found — bootstrap RBAC first (scripts/seed-role.ts super-admin).");
  }

  let created = 0;
  let alreadyThere = 0;
  for (const p of perms) {
    const existing = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: superAdmin.id, permissionId: p.id } },
    });
    if (existing) {
      alreadyThere++;
      continue;
    }
    await prisma.rolePermission.create({
      data: {
        roleId: superAdmin.id,
        permissionId: p.id,
        scopeRule: { kind: "all" },
      },
    });
    created++;
  }

  console.log(`[seed-recruitment-perms] super-admin grants: ${created} added, ${alreadyThere} already present.`);
  console.log(`[seed-recruitment-perms] Cache TTL is 60s — the nav link may take up to a minute to appear on hot instances.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .then(async () => {
    const { default: prisma } = await import("../lib/prisma");
    await prisma.$disconnect();
  });
