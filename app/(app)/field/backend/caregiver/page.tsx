import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { requireFieldAdmin } from "@/lib/field/access";
import { CaregiverEditor } from "./_components/CaregiverEditor";

export const dynamic = "force-dynamic";

// Caregiver-practice catalog editor, inside the unified /field backend. Writes
// reuse the existing /api/admin/caregiver-practices endpoints.
export default async function CaregiverBackendPage() {
  if (!(await requireFieldAdmin())) redirect("/field");
  const categories = await prisma.caregiverPracticeCategory.findMany({
    orderBy: { sortOrder: "asc" },
    select: {
      id: true, code: true, name: true, sortOrder: true, isActive: true,
      practices: {
        orderBy: [{ subcategory: "asc" }, { sortOrder: "asc" }],
        select: { id: true, code: true, subcategory: true, shortLabel: true, fullText: true, trainingModule: true, sortOrder: true, isActive: true },
      },
    },
  });
  return <CaregiverEditor categories={JSON.parse(JSON.stringify(categories))} />;
}
