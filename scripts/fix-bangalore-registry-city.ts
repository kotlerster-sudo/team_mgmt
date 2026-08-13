// The Bangalore granting unit drifted to registryCity="Chennai" after the
// 20260802120000_granting_unit migration seeded it as "Bangalore", so every
// Bangalore budget surface (Cost Analysis, line working, export) was reading
// Chennai's registry, templates and domain configs.
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { prisma } = await import("../lib/prisma");

  const before = await prisma.grantingUnit.findMany({
    select: { id: true, name: true, kind: true, registryCity: true },
    orderBy: { sortOrder: "asc" },
  });
  console.log("before:");
  for (const u of before) console.log(` ${u.name.padEnd(18)} kind=${u.kind.padEnd(12)} registryCity=${u.registryCity}`);

  const target = before.find(u => u.id === "gu_bangalore");
  if (!target) throw new Error("gu_bangalore not found");
  if (target.registryCity === "Bangalore") {
    console.log("\nalready correct — nothing to do");
    return;
  }

  await prisma.grantingUnit.update({
    where: { id: "gu_bangalore" },
    data: { registryCity: "Bangalore" },
  });

  const after = await prisma.grantingUnit.findMany({
    select: { name: true, kind: true, registryCity: true },
    orderBy: { sortOrder: "asc" },
  });
  console.log("\nafter:");
  for (const u of after) console.log(` ${u.name.padEnd(18)} kind=${u.kind.padEnd(12)} registryCity=${u.registryCity}`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
