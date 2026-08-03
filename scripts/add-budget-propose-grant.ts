/**
 * Additive RBAC seed — adds the `budget.propose` permission and grants it to
 * the `partner` role (scope: own) and `super-admin` (scope: all), without
 * touching any existing RolePermission row.
 *
 * `budget.propose` gates nav and useHasGrant visibility for a grantee editing a
 * draft the lead shared with them. It is NOT the write gate — that is
 * withBudgetLineWrite() in lib/budget/budgetAccess.ts, which additionally
 * checks the budget's status and partnerEditState.
 *
 * Run once after deploying the partner-draft-editing change:
 *   npx tsx --env-file=.env.local scripts/add-budget-propose-grant.ts
 *
 * Safe to re-run. Do NOT run scripts/seed-rbac.ts instead — seedRole() deletes
 * and recreates a role's grants, discarding the config/prod reconciliation.
 */

import prisma from "../lib/prisma";
import { invalidateRbacCache } from "../lib/rbac";

const RESOURCE = "budget";
const ACTION = "propose";

const GRANTS: { role: string; scopeRule: unknown }[] = [
  { role: "partner", scopeRule: { kind: "own" } },
  { role: "super-admin", scopeRule: { kind: "all" } },
];

async function main() {
  const before = await prisma.permission.findUnique({
    where: { resource_action: { resource: RESOURCE, action: ACTION } },
  });
  const permission = await prisma.permission.upsert({
    where: { resource_action: { resource: RESOURCE, action: ACTION } },
    create: { resource: RESOURCE, action: ACTION },
    update: {},
  });
  console.log(`✓ Permission ${RESOURCE}.${ACTION}: ${before ? "already existed" : "created"}`);

  for (const g of GRANTS) {
    const role = await prisma.role.findUnique({ where: { name: g.role } });
    if (!role) {
      console.log(`  · ${g.role}: role doesn't exist, skipping`);
      continue;
    }
    const existing = await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
    });
    if (existing) {
      console.log(`  · ${g.role}: already granted, leaving its scope untouched`);
      continue;
    }
    await prisma.rolePermission.create({
      data: { roleId: role.id, permissionId: permission.id, scopeRule: g.scopeRule as object },
    });
    console.log(`  ✓ ${g.role}: granted`);
  }

  invalidateRbacCache();
  console.log("\nDone. RBAC cache cleared.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
