/**
 * Additive RBAC seed — inserts the new `action_point.assign` permission and
 * grants it to super-admin, admin (all) and member (team).
 *
 *   npx tsx --env-file=.env.local scripts/add-action-point-assign-grant.ts
 *
 * Safe to re-run. Deliberately NOT `scripts/seed-rbac.ts` — seedRole() deletes
 * and recreates a role's grants, which would discard the reconciliation done
 * on 2026-08-02.
 */

import prisma from "../lib/prisma";
import { invalidateRbacCache } from "../lib/rbac";

const RESOURCE = "action_point";
const ACTION = "assign";

// member = TEAM: an RP's team resolves to just themselves, so the same grant
// covers self-assignment; a ZL's expands to their reports.
const GRANTS: Array<{ role: string; scopeRule: { kind: string } }> = [
  { role: "super-admin", scopeRule: { kind: "all" } },
  { role: "admin",       scopeRule: { kind: "all" } },
  { role: "member",      scopeRule: { kind: "team" } },
];

async function main() {
  const permission = await prisma.permission.upsert({
    where: { resource_action: { resource: RESOURCE, action: ACTION } },
    create: { resource: RESOURCE, action: ACTION },
    update: {},
  });
  console.log(`✓ Permission ${RESOURCE}.${ACTION} → ${permission.id}`);

  for (const g of GRANTS) {
    const role = await prisma.role.findUnique({ where: { name: g.role } });
    if (!role) {
      console.log(`  · skipping ${g.role} (role doesn't exist)`);
      continue;
    }
    const existing = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
    });
    if (existing) {
      console.log(`  · ${g.role}: already granted (${JSON.stringify(existing.scopeRule)}) — left alone`);
      continue;
    }
    await prisma.rolePermission.create({
      data: { roleId: role.id, permissionId: permission.id, scopeRule: g.scopeRule },
    });
    console.log(`  ✓ ${g.role}: granted ${JSON.stringify(g.scopeRule)}`);
  }

  invalidateRbacCache();
  console.log("\nDone.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
