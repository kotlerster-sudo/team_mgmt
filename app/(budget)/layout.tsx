import { auth } from "@/lib/auth";
import { isBudgetAdmin, isSuperAdmin, isPartner } from "@/lib/roleGuard";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import SignOutButton from "@/components/SignOutButton";

export const metadata: Metadata = {
  title: "Budget Builder",
  description: "Grant proposal budget generator for partners",
};

export default async function BudgetLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const budgetOnly = isBudgetAdmin(session);
  const superAdmin = isSuperAdmin(session);

  const navLinkClass = "text-xs text-stone-500 hover:text-stone-800 whitespace-nowrap py-1";
  const dimLinkClass = "text-xs text-stone-400 hover:text-stone-700 whitespace-nowrap py-1";

  // Partners get a stripped header: only their budgets + sign out.
  if (isPartner(session)) {
    return (
      <div className="min-h-screen bg-stone-50">
        <header className="border-b border-stone-200 bg-white px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-sm font-semibold text-stone-800 tracking-wide">Grant Reporting</span>
          <div className="ml-auto flex items-center gap-4">
            <a href="/budget" className={navLinkClass}>My budgets</a>
            <a href="/budget/account" className={navLinkClass}>Account</a>
            <SignOutButton />
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 py-6 sm:py-8">{children}</main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="px-4 py-3 flex items-center gap-3">
          <a href="/portal" className={dimLinkClass}>← Portal</a>
          <span className="text-sm font-semibold text-stone-800 tracking-wide">Budget Builder</span>
          {budgetOnly && <div className="ml-auto"><SignOutButton /></div>}
        </div>
        <nav className="px-4 pb-2 -mt-1 flex items-center gap-4 overflow-x-auto sm:justify-end">
          <a href="/budget" className={navLinkClass}>Budgets</a>
          <a href="/budget/dashboard" className={navLinkClass}>Dashboard</a>
          {(superAdmin || budgetOnly) && <a href="/admin/partners" className={navLinkClass}>Partners</a>}
          {(superAdmin || budgetOnly) && <a href="/admin/granting-units" className={navLinkClass}>Units</a>}
          {(superAdmin || budgetOnly) && <a href="/admin/budgets" className={navLinkClass}>Approve</a>}
          <a href="/admin" className={dimLinkClass}>Admin</a>
          {budgetOnly && <a href="/settings" className={dimLinkClass}>Settings</a>}
        </nav>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}
