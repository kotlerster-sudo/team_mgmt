// Additively introduce the `field.manage` RBAC permission and grant it to the
// admin roles — WITHOUT the destructive seedRole() reset (which deletes+recreates
// a role's grants). seedPermissions() only upserts Permission rows; we then upsert
// the two RolePermission rows by hand. Safe to run on prod, idempotent.
//   DATABASE_URL=… npx tsx scripts/add-field-manage-grant.ts
import { prisma } from "../lib/prisma";
import { seedPermissions } from "../lib/rbacSeed";

async function main() {
  const n = await seedPermissions(); // upserts every catalog permission incl. field.manage
  const perm = await prisma.permission.findUnique({ where: { resource_action: { resource: "field", action: "manage" } } });
  if (!perm) throw new Error("field.manage permission missing after seedPermissions");
  console.log(`seedPermissions upserted ${n} permissions; field.manage id=${perm.id}`);

  for (const roleName of ["super-admin", "admin"]) {
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) { console.log(`  role ${roleName} not found — skipped`); continue; }
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
      create: { roleId: role.id, permissionId: perm.id, scopeRule: { kind: "all" } },
      update: {}, // leave any existing scope untouched
    });
    console.log(`  granted field.manage → ${roleName}`);
  }
  console.log("✔ done — grant field.manage to other roles from /settings/roles as needed");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
