import "./review-portal.css";
import { auth } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/roleGuard";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auditLog } from "@/lib/auditLog";

export const metadata: Metadata = {
  title: "Review Portal",
  description: "Grant note drafting and review",
};

export default async function ReviewLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!isSuperAdmin(session)) redirect("/portal");

  auditLog({
    entityType: "System",
    entityId: "review-portal",
    userId: session.user.id!,
    action: "portal_access",
  });
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-stone-200 bg-white px-4 py-3 flex items-center gap-3 min-w-0">
        <a href="/portal" className="text-xs text-stone-400 hover:text-stone-700 shrink-0">← Portal</a>
        <span className="text-sm font-semibold text-stone-800 tracking-wide shrink-0 hidden sm:inline">Review Portal</span>
        <nav className="ml-auto flex items-center gap-3 overflow-x-auto">
          <a href="/grant-notes" className="text-xs text-stone-500 hover:text-stone-800 shrink-0">Home</a>
          <a href="/grant-notes/draft" className="text-xs text-stone-500 hover:text-stone-800 shrink-0">Draft</a>
          <a href="/grant-notes/notes" className="text-xs text-stone-500 hover:text-stone-800 shrink-0 hidden sm:inline">Grant Notes</a>
          <a href="/due-diligence" className="text-xs text-stone-500 hover:text-stone-800 shrink-0">Due Diligence</a>
          <a href="/approvals" className="text-xs text-stone-500 hover:text-stone-800 shrink-0">Approvals</a>
          <a href="/grant-notes/admin" className="text-xs text-stone-400 hover:text-stone-700 shrink-0 hidden sm:inline">Admin</a>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
