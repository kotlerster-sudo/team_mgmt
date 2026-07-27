import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { getSchoolPlanAccess, canEditPlan, canViewPlan } from "@/lib/schoolPlan/access";
import { SCHOOL_PLAN_ROLES } from "@/lib/schoolPlan/roles";
import StepsClient from "../_components/StepsClient";
import LaunchDateEditor from "../_components/LaunchDateEditor";

export default async function StepsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  const access = await getSchoolPlanAccess(session);
  if (!canViewPlan(access, id)) redirect("/schools");

  const plan = await prisma.schoolPlan.findUnique({
    where: { id },
    select: {
      id: true, name: true, launchDate: true,
      categories: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, key: true, title: true, description: true, sortOrder: true },
      },
      steps: {
        // Ordered by (category sortOrder, sortOrder, stepNo) but we regroup
        // client-side by categoryId anyway, so this ordering is only a fallback.
        orderBy: [{ sortOrder: "asc" }, { stepNo: "asc" }],
        include: {
          owner: { select: { id: true, name: true, email: true } },
          substeps: {
            orderBy: { position: "asc" },
            include: { owner: { select: { id: true, name: true, email: true } } },
          },
        },
      },
    },
  });
  if (!plan) notFound();

  // Team pool for the assignee dropdown — plan members + super-admins.
  const users = await prisma.user.findMany({
    where: { role: { in: ["member", "admin", "super-admin"] } },
    orderBy: [{ name: "asc" }],
    select: { id: true, name: true, email: true },
    take: 200,
  });

  const canEdit = canEditPlan(access, id);
  const launchDateIso = plan.launchDate?.toISOString() ?? null;

  const categories = plan.categories.map((c) => ({
    id: c.id, key: c.key, title: c.title, description: c.description, sortOrder: c.sortOrder,
  }));
  const steps = plan.steps.map((s) => ({
    id: s.id,
    stepNo: s.stepNo,
    categoryId: s.categoryId,
    title: s.title,
    description: s.description,
    planSection: s.planSection,
    requiredArtifactType: s.requiredArtifactType,
    status: s.status,
    ownerUserId: s.ownerUserId,
    ownerLabel: s.owner ? (s.owner.name ?? s.owner.email) : null,
    ownerRole: s.ownerRole,
    dueDate: s.dueDate?.toISOString() ?? null,
    dueWeek: s.dueWeek,
    blockingNote: s.blockingNote,
    substeps: s.substeps.map((ss) => ({
      id: ss.id,
      title: ss.title,
      description: ss.description,
      status: ss.status,
      ownerUserId: ss.ownerUserId,
      ownerLabel: ss.owner ? (ss.owner.name ?? ss.owner.email) : null,
      ownerRole: ss.ownerRole,
      dueDate: ss.dueDate?.toISOString() ?? null,
      dueWeek: ss.dueWeek,
      blockingNote: ss.blockingNote,
    })),
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-stone-500">
        <Link href={`/schools/${id}`} className="hover:text-stone-700">← {plan.name}</Link>
      </div>
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-stone-900">Step tracker</h1>
          <p className="text-xs text-stone-500 mt-0.5">
            {steps.length} step{steps.length === 1 ? "" : "s"} across {categories.length} categor{categories.length === 1 ? "y" : "ies"} · owner (person or role), due date or week, status per school
          </p>
        </div>
        <LaunchDateEditor planId={plan.id} launchDate={launchDateIso} canEdit={canEdit} />
      </div>
      <StepsClient
        planId={plan.id}
        launchDate={launchDateIso}
        categories={categories}
        steps={steps}
        users={users.map((u) => ({ id: u.id, label: u.name ?? u.email }))}
        roles={SCHOOL_PLAN_ROLES.map((r) => ({ key: r.key, label: r.label }))}
        canEdit={canEdit}
      />
    </div>
  );
}
