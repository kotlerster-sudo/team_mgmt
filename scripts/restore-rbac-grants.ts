/**
 * Restore role→permission grants (with scopeRule) from a snapshot written by snapshot-rbac.ts.
 *
 * UPSERT-ONLY — never deletes. So after seed-rbac.ts has reset grants to code defaults, this
 * puts every snapshotted custom grant back to its saved scopeRule, while any grant seed ADDED
 * that wasn't in the snapshot (e.g. the new catalog_item.deploy) is left intact.
 *
 * It reports the net difference vs the snapshot so you can see exactly what changed.
 *
 * Run: set -a && source .env.local && set +a && npx tsx scripts/restore-rbac-grants.ts [path-to-snapshot.json]
 *      (defaults to rbac-backups/rbac-snapshot-latest.json)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import prisma from "../lib/prisma";

type SnapshotGrant = { roleName: string; resource: string; action: string; scopeRule: unknown };
type Snapshot = { takenAt: string; grants: SnapshotGrant[] };

const key = (roleName: string, resource: string, action: string) => `${roleName}::${resource}.${action}`;

async function main() {
  const file = process.argv[2] || join(process.cwd(), "rbac-backups", "rbac-snapshot-latest.json");
  const snapshot = JSON.parse(readFileSync(file, "utf8")) as Snapshot;
  console.log(`[rbac-restore] snapshot from ${snapshot.takenAt} · ${snapshot.grants.length} grants · ${file}`);

  const [roles, permissions, dbGrants] = await Promise.all([
    prisma.role.findMany({ select: { id: true, name: true } }),
    prisma.permission.findMany({ select: { id: true, resource: true, action: true } }),
    prisma.rolePermission.findMany({
      select: { scopeRule: true, role: { select: { name: true } }, permission: { select: { resource: true, action: true } } },
    }),
  ]);
  const roleId = new Map(roles.map((r) => [r.name, r.id]));
  const permId = new Map(permissions.map((p) => [`${p.resource}.${p.action}`, p.id]));

  const snapKeys = new Set(snapshot.grants.map((g) => key(g.roleName, g.resource, g.action)));
  const dbKeys = new Set(dbGrants.map((g) => key(g.role.name, g.permission.resource, g.permission.action)));

  // What seed left in the DB that the snapshot didn't have (kept as-is — e.g. catalog_item.deploy).
  const addedBySeed = [...dbKeys].filter((k) => !snapKeys.has(k)).sort();
  // What the snapshot had that the DB currently lacks (seed dropped — restore re-adds).
  const droppedBySeed = [...snapKeys].filter((k) => !dbKeys.has(k)).sort();

  let restored = 0;
  const skipped: string[] = [];
  for (const g of snapshot.grants) {
    const rid = roleId.get(g.roleName);
    const pid = permId.get(`${g.resource}.${g.action}`);
    if (!rid || !pid) { skipped.push(key(g.roleName, g.resource, g.action)); continue; }
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: rid, permissionId: pid } },
      create: { roleId: rid, permissionId: pid, scopeRule: g.scopeRule as object },
      update: { scopeRule: g.scopeRule as object },
    });
    restored += 1;
  }

  console.log(`[rbac-restore] restored ${restored}/${snapshot.grants.length} snapshot grants`);
  if (addedBySeed.length) {
    console.log(`[rbac-restore] KEPT (added by seed, not in snapshot) — ${addedBySeed.length}:`);
    for (const k of addedBySeed) console.log(`[rbac-restore]   + ${k}`);
  }
  if (droppedBySeed.length) console.log(`[rbac-restore] re-added ${droppedBySeed.length} grant(s) seed had dropped`);
  if (skipped.length) {
    console.log(`[rbac-restore] SKIPPED ${skipped.length} (role/permission missing in DB):`);
    for (const k of skipped) console.log(`[rbac-restore]   ? ${k}`);
  }
  console.log("[rbac-restore] done.");
}

main()
  .catch((err) => { console.error("[rbac-restore] FAILED:", err); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
