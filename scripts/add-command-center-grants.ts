/**
 * Additive RBAC seed — adds the `command_center.list` / `command_center.read`
 * permissions and grants them to `member` (scope: team), `admin` and
 * `super-admin` (scope: all), without touching any existing RolePermission row.
 *
 * The grant gates ENTRY to /command and its APIs; geographic scope (which
 * zones) is resolved server-side per designation by resolveCommandScope()
 * in lib/operations/command.ts — RP/Other resolve to no zones.
 *
 * Run once after deploying the command-center change:
 *   npx tsx --env-file=.env.local scripts/add-command-center-grants.ts
 *
 * Safe to re-run. Do NOT run scripts/seed-rbac.ts instead — seedRole() deletes
 * and recreates a role's grants, discarding the config/prod reconciliation.
 */

import prisma from "../lib/prisma";
import { invalidateRbacCache } from "../lib/rbac";

const RESOURCE = "command_center";
const ACTIONS = ["list", "read"] as const;

const GRANTS: { role: string; scopeRule: unknown }[] = [
  { role: "member", scopeRule: { kind: "team" } },
  { role: "admin", scopeRule: { kind: "all" } },
  { role: "super-admin", scopeRule: { kind: "all" } },
];

async function main() {
  for (const action of ACTIONS) {
    const before = await prisma.permission.findUnique({
      where: { resource_action: { resource: RESOURCE, action } },
    });
    const permission = await prisma.permission.upsert({
      where: { resource_action: { resource: RESOURCE, action } },
      create: { resource: RESOURCE, action },
      update: {},
    });
    console.log(`✓ Permission ${RESOURCE}.${action}: ${before ? "already existed" : "created"}`);

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
      console.log(`  ✓ ${g.role}: granted (${JSON.stringify(g.scopeRule)})`);
    }
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
