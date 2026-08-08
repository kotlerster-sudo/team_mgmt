/**
 * Additive RBAC seed for the caregiver_practice resource — adds the permission
 * rows + grants without touching any existing RolePermission.
 *
 *   member       → list, read (all)          — RPs need the taxonomy to capture
 *   admin/super  → list/read/create/update/delete (all)  — taxonomy editing
 *
 * On-visit CAPTURE is gated by the existing pitstop_event.update, not this.
 *
 *   npx tsx --env-file=.env.local scripts/add-caregiver-practice-grants.ts
 *
 * Safe to re-run. Do NOT run scripts/seed-rbac.ts (full reset).
 */

import prisma from "../lib/prisma";
import { invalidateRbacCache } from "../lib/rbac";

const RESOURCE = "caregiver_practice";
const ALL = { kind: "all" } as const;

const GRANTS: { role: string; actions: string[] }[] = [
  { role: "member", actions: ["list", "read"] },
  { role: "admin", actions: ["list", "read", "create", "update", "delete"] },
  { role: "super-admin", actions: ["list", "read", "create", "update", "delete"] },
];

async function main() {
  for (const g of GRANTS) {
    const role = await prisma.role.findUnique({ where: { name: g.role } });
    if (!role) {
      console.log(`· ${g.role}: role doesn't exist, skipping`);
      continue;
    }
    for (const action of g.actions) {
      const permission = await prisma.permission.upsert({
        where: { resource_action: { resource: RESOURCE, action } },
        create: { resource: RESOURCE, action },
        update: {},
      });
      const existing = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      });
      if (existing) {
        console.log(`  · ${g.role}.${action}: already granted`);
        continue;
      }
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: permission.id, scopeRule: ALL as object },
      });
      console.log(`  ✓ ${g.role}.${action}: granted`);
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
