import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { CalendarClock, Target, BarChart3, FileText, ClipboardCheck, Sprout, GraduationCap, UserSearch } from "lucide-react";
import Avatar from "@/components/Avatar";
import SignOutButton from "@/components/SignOutButton";
import { SurfaceProvider } from "@/components/rbac/RbacProviders";
import { buildRbacContext, can } from "@/lib/rbac";
import { getSeedingAccess } from "@/lib/seeding/access";
import { getSchoolPlanAccess } from "@/lib/schoolPlan/access";
import { isBudgetAdmin } from "@/lib/roleGuard";

export default async function PortalPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const firstName = session.user.name?.split(" ")[0] ?? "there";
  const seeding = await getSeedingAccess(session);
  const schoolPlans = await getSchoolPlanAccess(session);
  // budget-admins get a restricted chooser: Budget + Seeding only.
  const budgetOnly = isBudgetAdmin(session);
  // Recruitment card — gated on the same recruitment.list grant that used to
  // gate the nav-bar entry.
  const rbacCtx = await buildRbacContext(session);
  const canRecruit = await can(rbacCtx, "recruitment", "list");

  return (
    <SurfaceProvider id="portal.view">
    <div className="min-h-full bg-stone-50 flex flex-col items-center justify-center px-6 py-12">

      {/* Logo */}
      <div className="flex items-center gap-2.5 mb-10">
        <div className="w-9 h-9 rounded-xl bg-sky-500 flex items-center justify-center shadow-sm">
          <Target className="w-5 h-5 text-white" />
        </div>
        <span className="text-xl font-semibold text-stone-900 tracking-tight">Pitstop</span>
      </div>

      {/* Greeting */}
      <p className="text-stone-500 text-sm mb-8">Good day, {firstName}. What are you here for?</p>

      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-lg">

        {/* Operations + Setup — hidden for budget-admins */}
        {!budgetOnly && (
        <>
        <Link
          href="/operations"
          className="group flex flex-col gap-3 p-6 bg-sky-500 hover:bg-sky-600 rounded-2xl shadow-sm transition-all hover:shadow-md"
        >
          <div className="w-10 h-10 rounded-xl bg-sky-400/50 flex items-center justify-center">
            <CalendarClock className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-white font-semibold text-base">Operations</p>
            <p className="text-sky-100 text-xs mt-0.5 leading-relaxed">Centres · Today · Checklists · Follow-ups</p>
          </div>
        </Link>

        <Link
          href="/dashboard"
          className="group flex flex-col gap-3 p-6 bg-white hover:bg-stone-50 border border-stone-200 hover:border-stone-300 rounded-2xl shadow-sm transition-all hover:shadow-md"
        >
          <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center">
            <Target className="w-5 h-5 text-stone-500" />
          </div>
          <div>
            <p className="text-stone-800 font-semibold text-base">Setup</p>
            <p className="text-stone-400 text-xs mt-0.5 leading-relaxed">Goals · Maps · Planning · Review</p>
          </div>
        </Link>
        </>
        )}

        {/* Budget */}
        <Link
          href="/budget"
          className="group flex flex-col gap-3 p-6 bg-white hover:bg-stone-50 border border-stone-200 hover:border-stone-300 rounded-2xl shadow-sm transition-all hover:shadow-md"
        >
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-stone-800 font-semibold text-base">Budget</p>
            <p className="text-stone-400 text-xs mt-0.5 leading-relaxed">Programme budgets · Cost registry · Multi-year planning</p>
          </div>
        </Link>

        {/* Review Portal */}
        {!budgetOnly && (
        <Link
          href="/grant-notes"
          className="group flex flex-col gap-3 p-6 bg-white hover:bg-stone-50 border border-stone-200 hover:border-stone-300 rounded-2xl shadow-sm transition-all hover:shadow-md"
        >
          <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center">
            <FileText className="w-5 h-5 text-violet-600" />
          </div>
          <div>
            <p className="text-stone-800 font-semibold text-base">Review Portal</p>
            <p className="text-stone-400 text-xs mt-0.5 leading-relaxed">Grant notes · Drafts · Approvals</p>
          </div>
        </Link>
        )}

        {/* Seeding Civil Society Startups */}
        {seeding.canAccess && (
          <Link
            href="/seeding"
            className="group flex flex-col gap-3 p-6 bg-white hover:bg-stone-50 border border-stone-200 hover:border-stone-300 rounded-2xl shadow-sm transition-all hover:shadow-md"
          >
            <div className="w-10 h-10 rounded-xl bg-lime-50 flex items-center justify-center">
              <Sprout className="w-5 h-5 text-lime-600" />
            </div>
            <div>
              <p className="text-stone-800 font-semibold text-base">Seeding</p>
              <p className="text-stone-400 text-xs mt-0.5 leading-relaxed">Civil society startups · Checklist · Funnel · Geographies</p>
            </div>
          </Link>
        )}

        {/* School Plans (After-School Centres) */}
        {schoolPlans.canAccess && !budgetOnly && (
          <Link
            href="/schools"
            className="group flex flex-col gap-3 p-6 bg-white hover:bg-stone-50 border border-stone-200 hover:border-stone-300 rounded-2xl shadow-sm transition-all hover:shadow-md"
          >
            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
              <GraduationCap className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <p className="text-stone-800 font-semibold text-base">School Plans</p>
              <p className="text-stone-400 text-xs mt-0.5 leading-relaxed">After-school centres · Pilot plans · Tracker · Budget</p>
            </div>
          </Link>
        )}

        {/* Recruitment */}
        {canRecruit && !budgetOnly && (
          <Link
            href="/recruitment"
            className="group flex flex-col gap-3 p-6 bg-white hover:bg-stone-50 border border-stone-200 hover:border-stone-300 rounded-2xl shadow-sm transition-all hover:shadow-md"
          >
            <div className="w-10 h-10 rounded-xl bg-sky-50 flex items-center justify-center">
              <UserSearch className="w-5 h-5 text-sky-600" />
            </div>
            <div>
              <p className="text-stone-800 font-semibold text-base">Recruitment</p>
              <p className="text-stone-400 text-xs mt-0.5 leading-relaxed">Job descriptions · Locations · CV → scouting desks</p>
            </div>
          </Link>
        )}

        {/* Due Diligence */}
        {!budgetOnly && (
        <Link
          href="/due-diligence"
          className="group flex flex-col gap-3 p-6 bg-white hover:bg-stone-50 border border-stone-200 hover:border-stone-300 rounded-2xl shadow-sm transition-all hover:shadow-md sm:col-span-2"
        >
          <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
            <ClipboardCheck className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <p className="text-stone-800 font-semibold text-base">Due Diligence</p>
            <p className="text-stone-400 text-xs mt-0.5 leading-relaxed">Org profile · Compliance · Financials · Programme design</p>
          </div>
        </Link>
        )}

      </div>

      {/* User + sign out */}
      <div className="mt-12 flex items-center gap-3">
        <Avatar name={session.user.name} image={session.user.image} size="sm" />
        <span className="text-sm text-stone-500">{session.user.name ?? session.user.email}</span>
        <SignOutButton />
      </div>

    </div>
    </SurfaceProvider>
  );
}
