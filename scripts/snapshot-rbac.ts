/**
 * Snapshot the current RBAC state (roles, permissions, role→permission grants with scopeRule)
 * to a timestamped JSON file. READ-ONLY — safe to run against prod.
 *
 * Pair with restore-rbac-grants.ts: snapshot → run seed-rbac.ts → restore, so `seedRole`'s
 * deleteMany/createMany reset doesn't lose UI-applied custom grants (e.g. surface restrictions).
 *
 * Run: set -a && source .env.local && set +a && npx tsx scripts/snapshot-rbac.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import prisma from "../lib/prisma";

async function main() {
  const [roles, permissions, grants] = await Promise.all([
    prisma.role.findMany({ select: { name: true, description: true, isSystem: true }, orderBy: { name: "asc" } }),
    prisma.permission.findMany({ select: { resource: true, action: true }, orderBy: [{ resource: "asc" }, { action: "asc" }] }),
    prisma.rolePermission.findMany({
      select: {
        scopeRule: true,
        role: { select: { name: true } },
        permission: { select: { resource: true, action: true } },
      },
    }),
  ]);

  const snapshot = {
    takenAt: new Date().toISOString(),
    roles,
    permissions,
    grants: grants
      .map((g) => ({
        roleName: g.role.name,
        resource: g.permission.resource,
        action: g.permission.action,
        scopeRule: g.scopeRule,
      }))
      .sort((a, b) =>
        a.roleName.localeCompare(b.roleName) ||
        a.resource.localeCompare(b.resource) ||
        a.action.localeCompare(b.action),
      ),
  };

  const dir = join(process.cwd(), "rbac-backups");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `rbac-snapshot-${snapshot.takenAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(snapshot, null, 2));

  // Also (over)write a stable "latest" pointer the restore script defaults to.
  const latest = join(dir, "rbac-snapshot-latest.json");
  writeFileSync(latest, JSON.stringify(snapshot, null, 2));

  const byRole = new Map<string, number>();
  for (const g of snapshot.grants) byRole.set(g.roleName, (byRole.get(g.roleName) ?? 0) + 1);
  const withSurfaces = snapshot.grants.filter(
    (g) => g.scopeRule && typeof g.scopeRule === "object" && Array.isArray((g.scopeRule as { surfaces?: unknown }).surfaces),
  ).length;

  console.log(`[rbac-snapshot] ${snapshot.roles.length} roles · ${snapshot.permissions.length} permissions · ${snapshot.grants.length} grants`);
  for (const [name, n] of [...byRole.entries()].sort()) console.log(`[rbac-snapshot]   role ${name}: ${n} grants`);
  console.log(`[rbac-snapshot]   ${withSurfaces} grant(s) carry surface restrictions (the custom bits at risk)`);
  console.log(`[rbac-snapshot] wrote ${file}`);
  console.log(`[rbac-snapshot] latest → ${latest}`);
}

main()
  .catch((err) => { console.error("[rbac-snapshot] FAILED:", err); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
