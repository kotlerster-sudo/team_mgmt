/**
 * READ-ONLY dry-run of scripts/seed-recruitment-perms.ts. Reports exactly what
 * would change without touching the DB. Safe against prod.
 *
 * Run:   pnpm tsx scripts/dry-run-recruitment-perms.ts
 */

import "dotenv/config";

const RECRUITMENT_ACTIONS = ["list", "read", "create", "delete"] as const;

async function main() {
  const { default: prisma } = await import("../lib/prisma");

  console.log(`[dry-run] target DB: ${process.env.DATABASE_URL?.replace(/:[^:@/]+@/, ":***@")}`);
  console.log();

  const existingPerms = await prisma.permission.findMany({
    where: { resource: "recruitment", action: { in: [...RECRUITMENT_ACTIONS] } },
  });
  console.log(`[dry-run] Permission table:`);
  for (const action of RECRUITMENT_ACTIONS) {
    const hit = existingPerms.find((p) => p.action === action);
    console.log(`   recruitment.${action.padEnd(8)} ${hit ? `EXISTS  (id=${hit.id})` : `MISSING → will CREATE`}`);
  }
  console.log();

  const superAdmin = await prisma.role.findUnique({ where: { name: "super-admin" } });
  if (!superAdmin) {
    console.log(`[dry-run] super-admin role NOT FOUND — nothing else to check.`);
    return;
  }
  console.log(`[dry-run] super-admin role: ${superAdmin.id}`);

  console.log(`[dry-run] super-admin grants for recruitment.*:`);
  for (const action of RECRUITMENT_ACTIONS) {
    const perm = existingPerms.find((p) => p.action === action);
    if (!perm) {
      console.log(`   recruitment.${action.padEnd(8)} (Permission missing) → will CREATE grant`);
      continue;
    }
    const grant = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: superAdmin.id, permissionId: perm.id } },
    });
    if (grant) {
      console.log(`   recruitment.${action.padEnd(8)} GRANTED (scope=${JSON.stringify(grant.scopeRule)})`);
    } else {
      console.log(`   recruitment.${action.padEnd(8)} NOT granted → will ADD { kind: "all" }`);
    }
  }
  console.log();

  // Also report which OTHER roles have any recruitment.* grant, so the user can
  // see we're not disturbing anything.
  const allRoles = await prisma.role.findMany({ orderBy: { name: "asc" } });
  console.log(`[dry-run] Other roles carrying recruitment.* today (should be none in a fresh setup):`);
  const anyPermIds = existingPerms.map((p) => p.id);
  let touched = 0;
  for (const r of allRoles) {
    if (r.id === superAdmin.id) continue;
    const grants = anyPermIds.length
      ? await prisma.rolePermission.findMany({
          where: { roleId: r.id, permissionId: { in: anyPermIds } },
          include: { permission: true },
        })
      : [];
    if (grants.length) {
      touched++;
      console.log(`   ${r.name}: ${grants.map((g) => `${g.permission.resource}.${g.permission.action}`).join(", ")}`);
    }
  }
  if (touched === 0) console.log(`   (none)`);
  console.log();
  console.log(`[dry-run] Done — no rows written.`);
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
