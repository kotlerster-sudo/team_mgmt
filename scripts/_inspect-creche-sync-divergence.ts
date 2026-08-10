import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { prisma } from "../lib/prisma";

async function main() {
  const goals = await prisma.goal.findMany({
    where: {
      title: { contains: "Creche Programme", mode: "insensitive" },
      deletedAt: null,
    },
    select: {
      id: true,
      title: true,
      status: true,
      pitstops: {
        where: { deletedAt: null },
        orderBy: { order: "asc" },
        select: {
          id: true,
          title: true,
          templateKey: true,
          templateSlug: true,
          status: true,
          checklistItems: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              text: true,
              key: true,
              status: true,
              completionType: true,
              activities: {
                where: { deletedAt: null },
                select: { id: true, title: true, templateKey: true, status: true },
              },
            },
          },
        },
      },
    },
    orderBy: { title: "asc" },
  });

  // Only show the two in question + summarise all
  const targets = goals.filter((g) =>
    /muneshwar|royapuram/i.test(g.title)
  );
  const show = targets.length ? targets : goals;

  for (const g of show) {
    console.log("\n============================================================");
    console.log(`GOAL: ${g.title}`);
    console.log(`  id=${g.id}  status=${g.status}`);
    for (const p of g.pitstops) {
      console.log(`  PITSTOP: "${p.title}" status=${p.status} templateKey=${p.templateKey ?? "(none)"}`);
      for (const ci of p.checklistItems) {
        console.log(
          `    CHECKLIST: "${ci.text}"  status=${ci.status}  key=${ci.key ?? "(none-USERCREATED)"}  compType=${ci.completionType}`
        );
        for (const a of ci.activities) {
          console.log(
            `        ACTIVITY: "${a.title}"  status=${a.status}  templateKey=${a.templateKey ?? "(none-USERCREATED)"}`
          );
        }
      }
    }
  }

  console.log("\n\n=== ALL creche goals: quick title/templateSlug/#checklist summary ===");
  for (const g of goals) {
    const ciCount = g.pitstops.reduce((n, p) => n + p.checklistItems.length, 0);
    const pslug = g.pitstops[0]?.templateSlug ?? "(none)";
    console.log(`- ${g.title}  [pitstopSlug=${pslug}]  pitstops=${g.pitstops.length} checklistItems=${ciCount}`);
  }
}

main().finally(() => prisma.$disconnect());
